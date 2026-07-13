import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Modal, TextInput, Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../src/services/supabase';
import { colors, spacing, radius, typography } from '../../src/theme';

type Tab = 'global' | 'friends';

type Category = { key: string; label: string; unit: string; isCount?: boolean; asc?: boolean };
const CATEGORIES: Category[] = [
  { key: 'total_distance',   label: '누적 거리',  unit: 'km' },
  { key: 'max_speed',        label: '최고속도',   unit: 'km/h' },
  { key: 'zero_to_hundred',  label: '제로백',     unit: 's',  asc: true },
  { key: 'monthly_distance', label: '이번 달',    unit: 'km' },
  { key: 'longest_drive',    label: '최장 주행',  unit: 'km' },
  { key: 'total_drives',     label: '총 주행 수', unit: '회', isCount: true },
  { key: 'visited_cities',   label: '방문 도시',  unit: '곳', isCount: true },
  { key: 'avg_distance',     label: '평균 거리',  unit: 'km' },
];

type RankEntry = {
  rank: number;
  user_id: string;
  username: string;
  avatar_url: string | null;
  value: number;
  is_me?: boolean;
};

type SearchUser = { user_id: string; username: string; avatar_url: string | null };
type PendingRequest = { id: string; user_id: string; username: string; avatar_url: string | null };

function formatValue(value: number, cat: Category) {
  if (cat.isCount) return String(Math.round(value));
  if (value >= 1000) return `${(value / 1000).toFixed(1)}천`;
  return value.toFixed(1);
}

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <View style={[av.circle, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[av.text, { fontSize: size * 0.4 }]}>{(name ?? '?')[0].toUpperCase()}</Text>
    </View>
  );
}
const av = StyleSheet.create({
  circle: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  text: { color: '#fff', fontWeight: '700' },
});

export default function RankingScreen() {
  const [tab, setTab] = useState<Tab>('global');
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [rankings, setRankings] = useState<RankEntry[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 친구 상태
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);

  // 검색 모달
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);

  // 받은 요청 모달
  const [showRequests, setShowRequests] = useState(false);

  const category = CATEGORIES[categoryIdx];

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const user = session.user;
      setMyUserId(user.id);

      let data: RankEntry[] = [];
      if (tab === 'global') {
        const res = await supabase.rpc('get_global_ranking', { p_category: category.key, p_limit: 30 });
        data = res.data ?? [];
      } else {
        const [rankRes, acceptedRes, sentRes, receivedRes] = await Promise.all([
          supabase.rpc('get_friend_ranking', { p_user_id: user.id, p_category: category.key }),
          supabase.from('friendships').select('user_id, friend_id').or(`user_id.eq.${user.id},friend_id.eq.${user.id}`).eq('status', 'accepted'),
          supabase.from('friendships').select('friend_id').eq('user_id', user.id).eq('status', 'pending'),
          supabase.from('friendships').select('id, user_id, profiles!user_id(username, avatar_url)').eq('friend_id', user.id).eq('status', 'pending'),
        ]);

        data = rankRes.data ?? [];

        const accepted = new Set<string>();
        for (const f of acceptedRes.data ?? []) {
          accepted.add(f.user_id === user.id ? f.friend_id : f.user_id);
        }
        setFriendIds(accepted);

        const sent = new Set<string>();
        for (const f of sentRes.data ?? []) sent.add(f.friend_id);
        setSentIds(sent);

        const received = (receivedRes.data ?? []).map((r: any) => ({
          id: r.id,
          user_id: r.user_id,
          username: r.profiles?.username ?? '?',
          avatar_url: r.profiles?.avatar_url ?? null,
        }));
        setPendingRequests(received);
      }

      setRankings(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab, category.key]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    const { data } = await supabase.rpc('search_users', { p_query: query.trim() });
    setSearchResults(data ?? []);
    setSearching(false);
  };

  const addFriend = async (targetId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { error } = await supabase.from('friendships').insert({
      user_id: session.user.id,
      friend_id: targetId,
      status: 'pending',
    });
    if (error) {
      Alert.alert('오류', error.message);
    } else {
      setSentIds((prev) => new Set([...prev, targetId]));
    }
  };

  const acceptRequest = async (request: PendingRequest) => {
    const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', request.id);
    if (!error) {
      setPendingRequests((prev) => prev.filter((r) => r.id !== request.id));
      setFriendIds((prev) => new Set([...prev, request.user_id]));
    }
  };

  const rejectRequest = async (request: PendingRequest) => {
    await supabase.from('friendships').delete().eq('id', request.id);
    setPendingRequests((prev) => prev.filter((r) => r.id !== request.id));
  };

  const rankColor = (rank: number) => {
    if (rank === 1) return '#FFB800';
    if (rank === 2) return '#9EA4AF';
    if (rank === 3) return '#CD7F32';
    return colors.textTertiary;
  };

  return (
    <View style={s.container}>
      <Text style={s.screenTitle}>랭킹</Text>

      {/* 탭 */}
      <View style={s.tabs}>
        {(['global', 'friends'] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'global' ? '전체' : '친구'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 카테고리 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.catScroll} contentContainerStyle={s.catContent}>
        {CATEGORIES.map((c, i) => (
          <TouchableOpacity
            key={c.key}
            style={[s.chip, i === categoryIdx && s.chipActive]}
            onPress={() => setCategoryIdx(i)}
          >
            <Text style={[s.chipText, i === categoryIdx && s.chipTextActive]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 랭킹 리스트 */}
      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView
          style={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
        >
          {tab === 'friends' && (
            <>
              {pendingRequests.length > 0 && (
                <TouchableOpacity style={s.requestBanner} onPress={() => setShowRequests(true)}>
                  <Text style={s.requestBannerText}>친구 요청 {pendingRequests.length}건 대기 중</Text>
                  <Text style={s.requestBannerArrow}>확인 →</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.addFriendBtn} onPress={() => setShowSearch(true)}>
                <Text style={s.addFriendText}>+ 친구 추가</Text>
              </TouchableOpacity>
            </>
          )}

          {rankings.length === 0 ? (
            <Text style={s.empty}>
              {tab === 'friends' ? '친구를 추가하면 여기에 랭킹이 나와요' : '아직 데이터가 없어요'}
            </Text>
          ) : (
            rankings.map((entry) => (
              <View key={entry.user_id} style={[s.row, entry.is_me && s.rowMe]}>
                <Text style={[s.rank, { color: rankColor(entry.rank) }]}>
                  {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : entry.rank}
                </Text>
                <Avatar name={entry.username} />
                <Text style={s.rowName} numberOfLines={1}>{entry.username}{entry.is_me ? ' (나)' : ''}</Text>
                <Text style={s.rowValue}>
                  {formatValue(entry.value, category)} <Text style={s.rowUnit}>{category.unit}</Text>
                </Text>
              </View>
            ))
          )}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      {/* 친구 검색 모달 */}
      <Modal visible={showSearch} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowSearch(false)}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>친구 추가</Text>
            <TouchableOpacity onPress={() => { setShowSearch(false); setQuery(''); setSearchResults([]); }}>
              <Text style={s.modalClose}>닫기</Text>
            </TouchableOpacity>
          </View>

          <View style={s.searchRow}>
            <TextInput
              style={s.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="닉네임 검색"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="search"
              onSubmitEditing={handleSearch}
              autoFocus
            />
            <TouchableOpacity style={s.searchBtn} onPress={handleSearch}>
              {searching ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.searchBtnText}>검색</Text>}
            </TouchableOpacity>
          </View>

          <ScrollView style={s.searchResults}>
            {searchResults.map((u) => {
              const isFriend = friendIds.has(u.user_id);
              const isSent = sentIds.has(u.user_id);
              return (
                <View key={u.user_id} style={s.searchRow2}>
                  <Avatar name={u.username} />
                  <Text style={s.searchName}>{u.username}</Text>
                  <TouchableOpacity
                    style={[s.addBtn, (isFriend || isSent) && s.addBtnDone]}
                    onPress={() => addFriend(u.user_id)}
                    disabled={isFriend || isSent}
                  >
                    <Text style={s.addBtnText}>
                      {isFriend ? '친구' : isSent ? '요청됨' : '추가'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* 받은 친구 요청 모달 */}
      <Modal visible={showRequests} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowRequests(false)}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>친구 요청</Text>
            <TouchableOpacity onPress={() => setShowRequests(false)}>
              <Text style={s.modalClose}>닫기</Text>
            </TouchableOpacity>
          </View>

          <ScrollView>
            {pendingRequests.length === 0 ? (
              <Text style={s.empty}>받은 요청이 없어요</Text>
            ) : (
              pendingRequests.map((r) => (
                <View key={r.id} style={s.requestRow}>
                  <Avatar name={r.username} />
                  <Text style={s.searchName}>{r.username}</Text>
                  <TouchableOpacity style={s.acceptBtn} onPress={() => acceptRequest(r)}>
                    <Text style={s.acceptBtnText}>수락</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.rejectBtn} onPress={() => rejectRequest(r)}>
                    <Text style={s.rejectBtnText}>거절</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  screenTitle: { ...typography.title, paddingHorizontal: spacing.md, paddingTop: 56, paddingBottom: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  empty: { ...typography.label, textAlign: 'center', paddingTop: 48 },

  tabs: { flexDirection: 'row', marginHorizontal: spacing.md, backgroundColor: colors.card, borderRadius: radius.sm, padding: 3 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.sm - 2 },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: '#fff' },

  catScroll: { marginTop: spacing.sm, flexGrow: 0 },
  catContent: { paddingHorizontal: spacing.md, gap: spacing.xs, alignItems: 'center' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.divider,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '600' },

  list: { flex: 1, marginTop: spacing.sm },

  requestBanner: {
    marginHorizontal: spacing.md, marginBottom: spacing.xs,
    backgroundColor: colors.primaryLight, borderRadius: radius.md,
    padding: spacing.md, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
  },
  requestBannerText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  requestBannerArrow: { fontSize: 13, color: colors.primary },

  addFriendBtn: {
    marginHorizontal: spacing.md, marginBottom: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center',
    borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed',
  },
  addFriendText: { color: colors.primary, fontWeight: '600', fontSize: 14 },

  row: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: spacing.md, marginBottom: spacing.xs,
    backgroundColor: colors.card, borderRadius: radius.md,
    paddingVertical: 12, paddingHorizontal: spacing.md, gap: spacing.sm,
  },
  rowMe: { borderWidth: 1.5, borderColor: colors.primary },
  rank: { width: 28, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  rowName: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.text },
  rowValue: { fontSize: 16, fontWeight: '700', color: colors.text },
  rowUnit: { fontSize: 12, fontWeight: '400', color: colors.textSecondary },

  modal: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  modalTitle: { ...typography.heading },
  modalClose: { fontSize: 15, color: colors.primary, fontWeight: '600' },

  searchRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  searchInput: {
    flex: 1, height: 44, backgroundColor: colors.card,
    borderRadius: radius.sm, paddingHorizontal: spacing.sm,
    fontSize: 15, color: colors.text,
  },
  searchBtn: {
    backgroundColor: colors.primary, borderRadius: radius.sm,
    height: 44, paddingHorizontal: spacing.md,
    alignItems: 'center', justifyContent: 'center',
  },
  searchBtnText: { color: '#fff', fontWeight: '600' },

  searchResults: { flex: 1 },
  searchRow2: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.xs,
  },
  searchName: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.text },
  addBtn: {
    backgroundColor: colors.primary, borderRadius: radius.sm,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  addBtnDone: { backgroundColor: colors.textTertiary },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  requestRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.xs,
  },
  acceptBtn: {
    backgroundColor: colors.primary, borderRadius: radius.sm,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  acceptBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  rejectBtn: {
    backgroundColor: colors.card, borderRadius: radius.sm,
    paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: colors.divider,
  },
  rejectBtnText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
});
