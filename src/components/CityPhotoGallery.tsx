import { useEffect, useRef, useState } from 'react';
import {
  Modal, View, StyleSheet, Image, TouchableOpacity, Text,
  ActivityIndicator, FlatList, Alert, useWindowDimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  listCityPhotos, addCityPhotos, deleteCityPhotos,
  reorderCityPhotos, recropAndSetCover,
  type CityPhoto,
} from '../services/cityPhotos';
import { CityPhotoCropperContent } from './CityPhotoCropper';
import CrashAlertBoundary from './CrashAlertBoundary';
import { colors } from '../theme';
import {
  pageIndexFromOffset,
  preserveLegacyInset,
  TAB_CONTENT_MAX_WIDTH,
} from '../utils/responsiveLayout';
import CITY_DATA from '../../assets/korea-cities.json';

type LatLng = { latitude: number; longitude: number };
type CityGeo = { code: string; polygons: LatLng[][] };
const CITIES = CITY_DATA as CityGeo[];

export default function CityPhotoGallery({
  visible,
  userId,
  visitedId,
  cityCode,
  cityName,
  autoAdd,
  startInEdit,
  onClose,
  onChanged,
}: {
  visible: boolean;
  userId: string | null;
  visitedId: string | null;
  cityCode: string | null;
  cityName: string;
  autoAdd?: boolean;
  startInEdit?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [photos, setPhotos] = useState<CityPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [cropQueue, setCropQueue] = useState<ImagePicker.ImagePickerAsset[] | null>(null);
  const [recropTarget, setRecropTarget] = useState<CityPhoto | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const autoAddTriggeredRef = useRef(false);
  const galleryRef = useRef<FlatList<CityPhoto>>(null);
  const previousWidthRef = useRef(width);

  useEffect(() => {
    if (!visible || !visitedId) {
      autoAddTriggeredRef.current = false;
      setEditMode(false);
      setSelectMode(false);
      setSelectedIds(new Set());
      setCropQueue(null);
      setRecropTarget(null);
      return;
    }
    setEditMode(!!startInEdit);
    setLoading(true);
    listCityPhotos(visitedId).then((data) => {
      setPhotos(data);
      setIndex(0);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, visitedId]);

  useEffect(() => {
    if (visible && autoAdd && !autoAddTriggeredRef.current) {
      autoAddTriggeredRef.current = true;
      // 갤러리 모달의 등장 애니메이션이 끝나기 전에 시스템 사진 선택기를 띄우면
      // iOS가 모달 프레젠테이션 스택을 잘못 처리해 전체가 닫히는 문제가 있어 살짝 지연
      const t = setTimeout(() => handleAdd(), 500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, autoAdd]);

  useEffect(() => {
    setIndex((currentIndex) => Math.min(currentIndex, Math.max(0, photos.length - 1)));
  }, [photos.length]);

  useEffect(() => {
    if (!visible || editMode || cropQueue || recropTarget || photos.length === 0) return;
    if (previousWidthRef.current === width) return;
    previousWidthRef.current = width;
    const alignedIndex = Math.min(index, Math.max(0, photos.length - 1));
    const animationFrame = requestAnimationFrame(() => {
      galleryRef.current?.scrollToOffset({ offset: alignedIndex * width, animated: false });
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [cropQueue, editMode, photos.length, recropTarget, visible, width]);

  if (!visible) return null;

  const current = photos[index] ?? null;

  const refresh = async () => {
    if (!visitedId) return;
    const data = await listCityPhotos(visitedId);
    setPhotos(data);
    setIndex((i) => Math.min(i, Math.max(0, data.length - 1)));
    onChanged();
  };

  const uploadImages = async (images: { uri: string; mimeType?: string }[]) => {
    if (!userId || !visitedId || !cityCode || !images.length) return;

    // 낙관적 업데이트: 서버 업로드가 끝나기 전에 로컬 이미지로 바로 화면에 보여줌
    const startLen = photos.length;
    const tempIds = images.map((_, i) => `temp-${Date.now()}-${i}`);
    const tempPhotos: CityPhoto[] = images.map((img, i) => ({
      id: tempIds[i],
      visited_city_id: visitedId,
      storage_path: '',
      url: img.uri,
      is_cover: startLen === 0 && i === 0,
      position: startLen + i,
    }));
    setPhotos((prev) => [...prev, ...tempPhotos]);
    if (startLen === 0) setIndex(0);

    setUploadProgress({ done: 0, total: images.length });
    try {
      await addCityPhotos({
        userId, visitedCityId: visitedId, cityCode,
        images,
        onProgress: (done, total) => setUploadProgress({ done, total }),
      });
      await refresh();
    } catch (e: any) {
      setPhotos((prev) => prev.filter((p) => !tempIds.includes(p.id)));
      Alert.alert('업로드 실패', e.message ?? String(e));
    } finally {
      setUploadProgress(null);
    }
  };

  const cityPolygons = cityCode ? CITIES.find((c) => c.code === cityCode)?.polygons ?? [] : [];

  const handleAdd = async () => {
    try {
      if (!userId || !visitedId || !cityCode) return;
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('권한 필요', '사진 라이브러리 접근 권한이 필요해요.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 0.9, allowsMultipleSelection: true,
        // iOS 갤러리 원본이 HEIC인 경우가 많아 호환 포맷(JPEG)으로 강제 변환
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled || !result.assets.length) return;

      // photos state는 다른 도시를 보다가 넘어온 직후엔 아직 갱신 전일 수 있어(비동기 갱신) —
      // 크롭 여부 판단은 항상 서버에서 새로 조회한 값으로 함
      const existingPhotos = await listCityPhotos(visitedId);
      if (existingPhotos.length === 0 && cityPolygons.length > 0) {
        // 아직 대표사진이 없는 도시 — 첫 장은 크롭해서 도시 모양에 맞는 프레이밍을 고르게 함
        setCropQueue(result.assets);
      } else {
        setEditMode(true);
        await uploadImages(result.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType })));
      }
    } catch (e: any) {
      Alert.alert('사진 등록 실패', e?.message ?? String(e));
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDeleteSelected = () => {
    if (!visitedId || !cityCode || selectedIds.size === 0) return;
    const targets = photos.filter((p) => selectedIds.has(p.id));
    Alert.alert('사진 삭제', `선택한 사진 ${targets.length}장을 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive', onPress: async () => {
          setBusy(true);
          try {
            await deleteCityPhotos({ visitedCityId: visitedId, cityCode, photos: targets });
            setSelectMode(false);
            setSelectedIds(new Set());
            await refresh();
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const handleDragEnd = async (data: CityPhoto[]) => {
    const prevFirstId = photos[0]?.id;
    setPhotos(data);
    if (!visitedId || !cityCode) return;

    await reorderCityPhotos(data);

    const newFirst = data[0];
    if (newFirst && newFirst.id !== prevFirstId && !newFirst.id.startsWith('temp-')) {
      // 순서 변경으로 대표사진이 바뀜 — 새 1번 사진을 다시 프레이밍
      setRecropTarget(newFirst);
    } else {
      onChanged();
    }
  };

  if (cropQueue) {
    return (
      <CrashAlertBoundary>
        <Modal visible={visible} animationType="fade" transparent onRequestClose={() => setCropQueue(null)}>
          <CityPhotoCropperContent
            visible
            imageUri={cropQueue[0]?.uri ?? null}
            polygons={cityPolygons}
            onCancel={() => setCropQueue(null)}
            onConfirm={(croppedUri) => {
              const rest = cropQueue.slice(1);
              setCropQueue(null);
              uploadImages([
                { uri: croppedUri, mimeType: 'image/jpeg' },
                ...rest.map((a) => ({ uri: a.uri, mimeType: a.mimeType })),
              ]);
            }}
          />
        </Modal>
      </CrashAlertBoundary>
    );
  }

  if (recropTarget) {
    return (
      <CrashAlertBoundary>
        <Modal visible={visible} animationType="fade" transparent onRequestClose={() => { setRecropTarget(null); onChanged(); }}>
          <CityPhotoCropperContent
            visible
            imageUri={recropTarget.url}
            polygons={cityPolygons}
            onCancel={() => { setRecropTarget(null); onChanged(); }}
            onConfirm={async (croppedUri) => {
              const target = recropTarget;
              setRecropTarget(null);
              if (!target || !visitedId || !cityCode) return;
              setBusy(true);
              try {
                await recropAndSetCover({ visitedCityId: visitedId, cityCode, photo: target, croppedUri });
                await refresh();
              } catch (e: any) {
                Alert.alert('대표사진 변경 실패', e?.message ?? String(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        </Modal>
      </CrashAlertBoundary>
    );
  }

  return (
    <CrashAlertBoundary>
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <View
          style={[
            s.header,
            {
              paddingTop: preserveLegacyInset(60, insets.top, 20),
              paddingLeft: insets.left + 20,
              paddingRight: insets.right + 20,
            },
          ]}
        >
          <View style={s.titleRow}>
            <Text style={s.title}>{cityName}</Text>
            {!editMode && current?.is_cover && <Text style={s.coverLabel}>대표사진</Text>}
          </View>
          <View style={s.headerRight}>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={s.closeText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>

        {editMode && photos.length > 0 && (
          <View
            style={[
              s.selectRow,
              { paddingLeft: insets.left + 20, paddingRight: insets.right + 20 },
            ]}
          >
            <TouchableOpacity
              onPress={() => {
                if (selectMode) { setSelectMode(false); setSelectedIds(new Set()); }
                else setSelectMode(true);
              }}
              disabled={busy}
              hitSlop={12}
            >
              {selectMode ? (
                <Text style={s.selectToggleX}>✕</Text>
              ) : (
                <Text style={s.selectText}>선택</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color="#fff" style={{ flex: 1 }} />
        ) : photos.length === 0 ? (
          <View style={s.emptyWrap}>
            <Text style={s.emptyText}>등록된 사진이 없어요</Text>
          </View>
        ) : !editMode ? (
          <>
            <FlatList
              ref={galleryRef}
              data={photos}
              keyExtractor={(p) => p.id}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              getItemLayout={(_, itemIndex) => ({
                length: width,
                offset: width * itemIndex,
                index: itemIndex,
              })}
              onMomentumScrollEnd={(event) => setIndex(pageIndexFromOffset(
                event.nativeEvent.contentOffset.x,
                width,
                photos.length,
              ))}
              renderItem={({ item }) => (
                <View style={[s.photoPage, { width }]}>
                  <Image source={{ uri: item.url }} style={[s.photo, { width }]} resizeMode="contain" />
                </View>
              )}
            />
            {photos.length > 1 && (
              <Text style={s.pageIndicator}>{index + 1} / {photos.length}</Text>
            )}
          </>
        ) : (
          <DraggableFlatList
            data={photos}
            keyExtractor={(p) => p.id}
            containerStyle={{ flex: 1 }}
            contentContainerStyle={[
              s.editContent,
              { paddingLeft: insets.left + 20, paddingRight: insets.right + 20 },
            ]}
            onDragEnd={({ data }) => handleDragEnd(data)}
            renderItem={({ item, drag, isActive, getIndex }: RenderItemParams<CityPhoto>) => {
              const pos = getIndex() ?? 0;
              const selected = selectedIds.has(item.id);
              return (
                <TouchableOpacity
                  style={[s.editRow, isActive && s.editRowActive]}
                  activeOpacity={selectMode ? 0.6 : 1}
                  onPress={selectMode ? () => toggleSelected(item.id) : undefined}
                  disabled={busy || (!selectMode && item.id.startsWith('temp-'))}
                >
                  {selectMode ? (
                    <View style={[s.checkbox, selected && s.checkboxChecked]}>
                      {selected && <Text style={s.checkboxMark}>✓</Text>}
                    </View>
                  ) : (
                    <Text style={s.editPosition}>{pos + 1}</Text>
                  )}
                  <Image source={{ uri: item.url }} style={s.editThumb} />
                  {pos === 0 && <Text style={s.editCoverBadge}>대표</Text>}
                  {!selectMode && !item.id.startsWith('temp-') && (
                    <TouchableOpacity style={s.dragHandle} onPressIn={drag} hitSlop={10}>
                      <View style={s.dragBar} />
                      <View style={s.dragBar} />
                      <View style={s.dragBar} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        )}

        <View
          style={[
            s.actionRow,
            {
              paddingLeft: insets.left + 20,
              paddingRight: insets.right + 20,
              paddingBottom: preserveLegacyInset(40, insets.bottom, 20),
            },
          ]}
        >
          {!selectMode ? (
            <>
              <TouchableOpacity style={s.actionBtn} onPress={handleAdd} disabled={busy}>
                <Text style={s.actionText}>사진 추가</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.actionBtn} onPress={() => setEditMode((v) => !v)} disabled={busy}>
                <Text style={s.actionText}>{editMode ? '완료' : '수정'}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={s.actionBtn}
                onPress={() => { setSelectMode(false); setSelectedIds(new Set()); }}
                disabled={busy}
              >
                <Text style={s.actionText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.actionBtn}
                onPress={handleDeleteSelected}
                disabled={busy || selectedIds.size === 0}
              >
                <Text style={[s.actionText, { color: colors.danger }]}>삭제 ({selectedIds.size})</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        {busy && !uploadProgress && (
          <View style={s.busyWrap}>
            <ActivityIndicator color="#fff" />
          </View>
        )}
        {uploadProgress && (
          <View style={s.progressBadge}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={s.busyText}>업로드 중 {uploadProgress.done}/{uploadProgress.total}</Text>
          </View>
        )}
      </View>
    </Modal>
    </CrashAlertBoundary>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    width: '100%', maxWidth: TAB_CONTENT_MAX_WIDTH, alignSelf: 'center', paddingBottom: 12,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  headerRight: { alignItems: 'flex-end', gap: 10 },
  closeText: { color: 'rgba(255,255,255,0.7)', fontSize: 15 },
  selectRow: {
    width: '100%', maxWidth: TAB_CONTENT_MAX_WIDTH, alignSelf: 'center',
    alignItems: 'flex-end', marginTop: 20, marginBottom: 8,
  },
  selectText: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  selectToggleX: { color: '#fff', fontSize: 16, fontWeight: '700' },
  photoPage: { alignItems: 'center', justifyContent: 'center' },
  photo: { height: '100%' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.5)', fontSize: 15 },
  pageIndicator: { color: 'rgba(255,255,255,0.6)', fontSize: 13, textAlign: 'center', marginTop: 8 },
  coverLabel: {
    color: colors.primary, fontSize: 12, fontWeight: '700',
    backgroundColor: 'rgba(4,120,87,0.15)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  editRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12,
    padding: 8, marginBottom: 10,
  },
  editRowActive: { backgroundColor: 'rgba(255,255,255,0.16)' },
  editContent: {
    width: '100%', maxWidth: TAB_CONTENT_MAX_WIDTH, alignSelf: 'center', paddingTop: 8,
  },
  editPosition: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '700', width: 20, textAlign: 'center' },
  editThumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: '#222' },
  editCoverBadge: {
    color: colors.primary, fontSize: 11, fontWeight: '700',
    backgroundColor: 'rgba(4,120,87,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  dragHandle: { marginLeft: 'auto', padding: 12, gap: 3 },
  dragBar: { width: 20, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.6)' },
  actionRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 12,
    width: '100%', maxWidth: TAB_CONTENT_MAX_WIDTH, alignSelf: 'center', paddingTop: 20,
  },
  actionBtn: {
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  busyWrap: { position: 'absolute', top: '50%', alignSelf: 'center', alignItems: 'center', gap: 8 },
  progressBadge: {
    position: 'absolute', top: 108, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16,
  },
  busyText: { color: '#fff', fontSize: 13 },
});
