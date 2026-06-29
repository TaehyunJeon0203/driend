import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Modal, TextInput, Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../src/services/supabase';
import { colors, spacing, radius, typography } from '../../src/theme';

type Tab = 'global' | 'friends';

type Category = { key: string; label: string; unit: string; isCount?: boolean };
const CATEGORIES: Category[] = [
  { key: 'total_distance',   label: '누적 거리',   unit: 'km' },
  { key: 'monthly_distance', label: '이번 달',     unit: 'km' },
  { key: 'total_drives',     label: '총 주행 수',  unit: '회', isCount: true },
  { key: 'visited_cities',   label: '방문 도시',   unit: '곳', isCount: true },
  { key: 'longest_drive',    label: '최장 주행',   unit: 'km' },
  { key: 'avg_distance',     label: '평균 거리',   unit: 'km' },
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

  // 친구 추가 모달
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);

  const category = CATEGORIES[categoryIdx];

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setMyUserId(user.id);

    let data: RankEntry[] = [];
    if (tab === 'global') {
      const res = await supabase.rpc('get_global_ranking', { p_category: category.key, p_limit: 30 });
      data = res.data ?? [];
    } else {
      const res = await supabase.rpc('get_friend_ranking', { p_user_id: user.id, p_category: category.key });
      data = res.data ?? [];

      // 친구 목록도 갱신
      const frRes = await supabase.from('friendships')
        .select('user_id, friend_id')
        .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);
      const ids = new Set<string>();
      for (const f of frRes.data ?? []) {
        ids.add(f.user_id === user.id ? f.friend_id : f.user_id);
      }
      setFriendIds(ids);
    }

    setRankings(data);
    setLoading(false);
    setRefreshing(false);
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (friendIds.has(targetId)) {
      Alert.alert('이미 친구예요');
      return;
    }
    const { error } = await supabase.from('friendships').insert({
      user_id: user.id,
      friend_id: targetId,
      status: 'accepted',
    });
    if (error) {
      Alert.alert('오류', error.message);
    } else {
      setFriendIds((prev) => new Set([...prev, targetId]));
    }
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
            <TouchableOpacity style={s.addFriendBtn} onPress={() => setShowSearch(true)}>
              <Text style={s.addFriendText}>+ 친구 추가</Text>
            </TouchableOpacity>
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
            {searchResults.map((u) => (
              <View key={u.user_id} style={s.searchRow2}>
                <Avatar name={u.username} />
                <Text style={s.searchName}>{u.username}</Text>
                <TouchableOpacity
                  style={[s.addBtn, friendIds.has(u.user_id) && s.addBtnDone]}
                  onPress={() => addFriend(u.user_id)}
                  disabled={friendIds.has(u.user_id)}
                >
                  <Text style={s.addBtnText}>{friendIds.has(u.user_id) ? '친구' : '추가'}</Text>
                </TouchableOpacity>
              </View>
            ))}
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
});
