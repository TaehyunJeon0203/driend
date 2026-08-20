import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  ActivityIndicator, Alert, Animated, Image, Linking, StyleSheet, Text, TouchableOpacity, View,
  type LayoutChangeEvent,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import {
  PanGestureHandler, PinchGestureHandler, State,
  type HandlerStateChangeEvent, type PanGestureHandlerEventPayload, type PinchGestureHandlerEventPayload,
} from 'react-native-gesture-handler';
import Svg, { Circle, Path } from 'react-native-svg';
import ViewShot, { type ViewShotRef } from 'react-native-view-shot';
import {
  createSpeedBands, createSpeedRouteSegments, fetchDriveResult, fitDriveComposition,
  formatDriveDateTime, formatDriveDuration, getAverageSpeedKmh, getDurationSeconds,
  projectRoute, type DriveResult, uploadDriveResultCard,
} from '../../src/services/driveResult';
import { colors, radius, spacing, typography } from '../../src/theme';

type Size = { width: number; height: number };
type EditTarget = 'photo' | 'result';

const TEXT_COLORS = [
  { label: '화이트', value: '#FFFFFF' },
  { label: '블랙', value: '#111827' },
  { label: '그레이', value: '#D1D5DB' },
  { label: '민트', value: '#6EE7B7' },
  { label: '옐로우', value: '#FDE68A' },
] as const;
type PhotoLoadResult = 'loaded' | 'error';
type PhotoLoadRecord = {
  uri: string;
  status: 'loading' | PhotoLoadResult;
  promise: Promise<PhotoLoadResult>;
  finish: (result: PhotoLoadResult) => void;
};

const PHOTO_LOAD_TIMEOUT_MS = 8000;

const afterNextPaint = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
});

function createPhotoLoadRecord(uri: string): PhotoLoadRecord {
  let resolveLoad: (result: PhotoLoadResult) => void = () => undefined;
  const promise = new Promise<PhotoLoadResult>((resolve) => { resolveLoad = resolve; });
  const record: PhotoLoadRecord = {
    uri,
    status: 'loading',
    promise,
    finish: (result) => {
      if (record.status !== 'loading') return;
      record.status = result;
      resolveLoad(result);
    },
  };
  return record;
}

function waitForPhotoLoad(record: PhotoLoadRecord): Promise<PhotoLoadResult | 'timeout'> {
  if (record.status !== 'loading') return Promise.resolve(record.status);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve('timeout'), PHOTO_LOAD_TIMEOUT_MS);
    record.promise.then((result) => {
      clearTimeout(timeout);
      resolve(result);
    });
  });
}

function useLayerTransform() {
  const baseScale = useRef(new Animated.Value(1)).current;
  const pinchScale = useRef(new Animated.Value(1)).current;
  const lastScale = useRef(1);
  const baseTranslate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const panTranslate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const lastTranslate = useRef({ x: 0, y: 0 });

  const reset = () => {
    lastScale.current = 1;
    lastTranslate.current = { x: 0, y: 0 };
    baseScale.setValue(1);
    pinchScale.setValue(1);
    baseTranslate.setValue({ x: 0, y: 0 });
    panTranslate.setValue({ x: 0, y: 0 });
  };

  const onPinchEvent = Animated.event([{ nativeEvent: { scale: pinchScale } }], { useNativeDriver: true });
  const onPinchStateChange = (event: HandlerStateChangeEvent<PinchGestureHandlerEventPayload>) => {
    if (event.nativeEvent.oldState !== State.ACTIVE) return;
    lastScale.current = Math.max(0.6, Math.min(6, lastScale.current * event.nativeEvent.scale));
    baseScale.setValue(lastScale.current);
    pinchScale.setValue(1);
  };
  const onPanEvent = Animated.event(
    [{ nativeEvent: { translationX: panTranslate.x, translationY: panTranslate.y } }],
    { useNativeDriver: true },
  );
  const onPanStateChange = (event: HandlerStateChangeEvent<PanGestureHandlerEventPayload>) => {
    if (event.nativeEvent.oldState !== State.ACTIVE) return;
    lastTranslate.current = {
      x: lastTranslate.current.x + event.nativeEvent.translationX,
      y: lastTranslate.current.y + event.nativeEvent.translationY,
    };
    baseTranslate.setValue(lastTranslate.current);
    panTranslate.setValue({ x: 0, y: 0 });
  };

  return {
    reset,
    style: {
      transform: [
        { translateX: Animated.add(baseTranslate.x, panTranslate.x) },
        { translateY: Animated.add(baseTranslate.y, panTranslate.y) },
        { scale: Animated.multiply(baseScale, pinchScale) },
      ],
    },
    gestureProps: { onPanEvent, onPanStateChange, onPinchEvent, onPinchStateChange },
  };
}

type GestureLayerProps = {
  active: boolean;
  children: ReactNode;
  transformStyle: ReturnType<typeof useLayerTransform>['style'];
  gestureProps: ReturnType<typeof useLayerTransform>['gestureProps'];
};

function GestureLayer({ active, children, transformStyle, gestureProps }: GestureLayerProps) {
  const panRef = useRef<ComponentRef<typeof PanGestureHandler>>(null);
  const pinchRef = useRef<ComponentRef<typeof PinchGestureHandler>>(null);
  const content = <Animated.View style={[StyleSheet.absoluteFill, transformStyle]}>{children}</Animated.View>;
  if (!active) return content;
  return (
    <PanGestureHandler
      ref={panRef}
      simultaneousHandlers={pinchRef}
      onGestureEvent={gestureProps.onPanEvent}
      onHandlerStateChange={gestureProps.onPanStateChange}
      minPointers={1}
      maxPointers={2}
    >
      <Animated.View style={StyleSheet.absoluteFill}>
        <PinchGestureHandler
          ref={pinchRef}
          simultaneousHandlers={panRef}
          onGestureEvent={gestureProps.onPinchEvent}
          onHandlerStateChange={gestureProps.onPinchStateChange}
        >
          {content}
        </PinchGestureHandler>
      </Animated.View>
    </PanGestureHandler>
  );
}

export default function DriveResultScreen() {
  const { id, editable } = useLocalSearchParams<{ id?: string; editable?: string }>();
  const insets = useSafeAreaInsets();
  const shotRef = useRef<ViewShotRef>(null);
  const photoLoadRef = useRef<PhotoLoadRecord | null>(null);
  const photoTransform = useLayerTransform();
  const resultTransform = useLayerTransform();
  const [result, setResult] = useState<DriveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canvasRegion, setCanvasRegion] = useState<Size>({ width: 0, height: 0 });
  const [routeSize, setRouteSize] = useState<Size>({ width: 0, height: 0 });
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget>('result');
  const [textColor, setTextColor] = useState<string>(TEXT_COLORS[1].value);
  const [exporting, setExporting] = useState(false);
  const canEdit = editable === '1';
  const canvasSize = fitDriveComposition(canvasRegion.width, canvasRegion.height);

  useEffect(() => {
    if (!id) { setError('올바르지 않은 주행 기록이에요.'); return; }
    let active = true;
    fetchDriveResult(id).then(
      (driveResult) => { if (active) setResult(driveResult); },
      (loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : '결과를 불러오지 못했어요.'); },
    );
    return () => { active = false; };
  }, [id]);

  const projected = useMemo(
    () => projectRoute(result?.points ?? [], routeSize.width, routeSize.height, 18),
    [result?.points, routeSize],
  );
  const bands = useMemo(() => createSpeedBands(result?.points ?? []), [result?.points]);
  const segments = useMemo(() => createSpeedRouteSegments(projected, bands), [bands, projected]);

  const pickPhoto = async () => {
    try {
      let permission = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) {
        permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      }
      if (!permission.granted) {
        Alert.alert(
          '사진 접근 권한 필요',
          '결과 배경 사진을 고르려면 설정에서 사진 접근을 허용해주세요.',
          [{ text: '취소', style: 'cancel' }, { text: '설정 열기', onPress: () => Linking.openSettings() }],
        );
        return;
      }
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsEditing: false,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (selection.canceled || !selection.assets[0]) return;
      const selectedUri = selection.assets[0].uri;
      photoLoadRef.current = createPhotoLoadRecord(selectedUri);
      setPhotoUri(selectedUri);
      photoTransform.reset();
      setEditTarget('photo');
    } catch (pickError) {
      Alert.alert('사진 선택 실패', pickError instanceof Error ? pickError.message : '사진을 불러오지 못했어요.');
    }
  };

  const captureComposition = async (): Promise<string> => {
    if (photoUri) {
      const photoLoad = photoLoadRef.current;
      if (!photoLoad || photoLoad.uri !== photoUri) throw new Error('선택한 사진의 상태를 확인하지 못했어요.');
      const loadResult = await waitForPhotoLoad(photoLoad);
      if (loadResult === 'timeout') throw new Error('사진을 불러오는 데 시간이 너무 오래 걸려요. 잠시 후 다시 시도해주세요.');
      if (loadResult === 'error') throw new Error('선택한 사진을 불러오지 못했어요. 다른 사진을 선택해주세요.');
    }
    await afterNextPaint();
    if (!shotRef.current?.capture) throw new Error('이미지를 만들지 못했어요.');
    return shotRef.current.capture();
  };

  const finishEditing = async () => {
    setEditing(false);
    if (!result) return;
    try {
      const uri = await captureComposition();
      await uploadDriveResultCard(result.id, uri);
    } catch (persistError) {
      Alert.alert('저장 실패', persistError instanceof Error ? persistError.message : '주행 인증 카드를 저장하지 못했어요.');
    }
  };

  const saveImage = async () => {
    if (exporting || !result) return;
    setExporting(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
      if (!permission.granted) {
        Alert.alert('권한 필요', '결과 이미지를 저장하려면 사진 추가 권한이 필요해요.');
        return;
      }
      const uri = await captureComposition();
      await uploadDriveResultCard(result.id, uri);
      await MediaLibrary.Asset.create(uri);
      Alert.alert('저장 완료', '주행 결과를 사진 앱에 저장했어요.');
    } catch (saveError) {
      Alert.alert('저장 실패', saveError instanceof Error ? saveError.message : '이미지를 저장하지 못했어요.');
    } finally {
      setExporting(false);
    }
  };

  const shareImage = async () => {
    if (exporting || !result) return;
    setExporting(true);
    try {
      if (!await Sharing.isAvailableAsync()) throw new Error('이 기기에서는 공유 기능을 사용할 수 없어요.');
      const uri = await captureComposition();
      await uploadDriveResultCard(result.id, uri);
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: '주행 결과 공유' });
    } catch (shareError) {
      Alert.alert('공유 실패', shareError instanceof Error ? shareError.message : '이미지를 공유하지 못했어요.');
    } finally {
      setExporting(false);
    }
  };

  if (!result) {
    return (
      <View style={s.center}>
        {error ? <><Text style={s.error}>{error}</Text><TouchableOpacity onPress={() => router.back()}><Text style={s.backLink}>돌아가기</Text></TouchableOpacity></> : <ActivityIndicator size="large" color={colors.primary} />}
      </View>
    );
  }

  const durationSeconds = getDurationSeconds(result);
  const averageSpeed = getAverageSpeedKmh(result);
  const dateTime = formatDriveDateTime(result.startedAt);
  const photoActive = editing && editTarget === 'photo' && !!photoUri;
  const resultActive = editing && editTarget === 'result';

  return (
    <View style={[s.screen, { paddingTop: insets.top + spacing.xs, paddingBottom: insets.bottom + spacing.sm }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.headerButton} onPress={() => router.back()} accessibilityLabel="뒤로 가기">
          <Text style={s.headerButtonText}>‹</Text>
        </TouchableOpacity>
        <Text style={s.title}>주행 결과</Text>
        {canEdit ? (
          <TouchableOpacity style={s.headerAction} onPress={editing ? finishEditing : () => setEditing(true)}>
            <Text style={s.headerActionText}>{editing ? '완료' : '편집'}</Text>
          </TouchableOpacity>
        ) : <View style={s.headerAction} />}
      </View>

      <View
        style={s.canvasRegion}
        onLayout={(event: LayoutChangeEvent) => {
          const { width, height } = event.nativeEvent.layout;
          setCanvasRegion((current) => current.width === width && current.height === height ? current : { width, height });
        }}
      >
        {canvasSize.width > 0 && canvasSize.height > 0 ? (
          <ViewShot
            ref={shotRef}
            style={[s.composition, canvasSize, { backgroundColor: photoUri ? '#000' : colors.background }]}
            options={{ format: 'png', quality: 1 }}
          >
            {result.resultImageUrl && !canEdit ? (
              <Image source={{ uri: result.resultImageUrl }} resizeMode="contain" style={StyleSheet.absoluteFill} />
            ) : <>
            {photoUri ? (
              <View style={StyleSheet.absoluteFill} pointerEvents={photoActive ? 'auto' : 'none'}>
                <GestureLayer active={photoActive} transformStyle={photoTransform.style} gestureProps={photoTransform.gestureProps}>
                  <Image
                    key={photoUri}
                    source={{ uri: photoUri }}
                    resizeMode="contain"
                    style={StyleSheet.absoluteFill}
                    onLoad={() => {
                      if (photoLoadRef.current?.uri === photoUri) photoLoadRef.current.finish('loaded');
                    }}
                    onError={() => {
                      if (photoLoadRef.current?.uri === photoUri) photoLoadRef.current.finish('error');
                    }}
                  />
                </GestureLayer>
              </View>
            ) : null}
            {photoUri ? <View pointerEvents="none" style={s.photoScrim} /> : null}

            <View style={StyleSheet.absoluteFill} pointerEvents={resultActive ? 'auto' : 'none'}>
              <GestureLayer active={resultActive} transformStyle={resultTransform.style} gestureProps={resultTransform.gestureProps}>
                <View style={s.resultGroup}>
                  <Text style={[s.brand, { color: textColor }, photoUri && s.onPhotoText]}>Driend</Text>
                  <View>
                     <Text style={[s.date, photoUri && s.onPhotoSecondary, { color: textColor }]}>{dateTime.date}</Text>
                     <Text style={[s.time, photoUri && s.onPhotoText, { color: textColor }]}>{dateTime.time}</Text>
                  </View>

                  <View
                    style={[s.route, projected.length < 2 && s.routeFallback, photoUri && projected.length < 2 && s.routeFallbackOnPhoto]}
                    onLayout={(event: LayoutChangeEvent) => {
                      const { width, height } = event.nativeEvent.layout;
                      setRouteSize((current) => current.width === width && current.height === height ? current : { width, height });
                    }}
                  >
                    {projected.length >= 2 ? (
                      <Svg width="100%" height="100%">
                        {segments.map((segment, index) => <Path key={`${segment.color}-${index}`} d={segment.path} stroke={segment.color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
                        <Circle cx={projected[0].x} cy={projected[0].y} r={5} fill="#fff" stroke={colors.primary} strokeWidth={3} />
                        <Circle cx={projected[projected.length - 1].x} cy={projected[projected.length - 1].y} r={5} fill="#191919" stroke="#fff" strokeWidth={2} />
                      </Svg>
                    ) : <Text style={[s.noRoute, photoUri && s.onPhotoSecondary, { color: textColor }]}>표시할 경로가 부족해요</Text>}
                  </View>

                  <View>
                     <Text style={[s.heroLabel, photoUri && s.onPhotoSecondary, { color: textColor }]}>DISTANCE</Text>
                     <Text style={[s.heroValue, photoUri && s.onPhotoText, { color: textColor }]} adjustsFontSizeToFit numberOfLines={1}>
                       {result.distanceKm.toFixed(1)}<Text style={[s.heroUnit, !photoUri && s.heroUnitPlain, { color: textColor }]}> km</Text>
                     </Text>
                     <View style={s.metrics}>
                       <Metric label="최고 속도" value={`${Math.round(result.maxSpeedKmh)}`} unit="km/h" onPhoto={!!photoUri} textColor={textColor} />
                       <Metric label="평균 속도" value={`${Math.round(averageSpeed)}`} unit="km/h" onPhoto={!!photoUri} textColor={textColor} />
                       <Metric label="주행 시간" value={formatDriveDuration(durationSeconds)} onPhoto={!!photoUri} textColor={textColor} />
                    </View>
                  </View>
                </View>
              </GestureLayer>
            </View>
            </>}
          </ViewShot>
        ) : null}
      </View>

      {editing ? (
        <View style={s.editor}>
           <Text style={s.editorHint}>{editTarget === 'photo' ? '사진을 이동하거나 확대/축소하세요' : '텍스트를 이동하거나 확대/축소하세요'}</Text>
          <View style={s.targetRow}>
            <TouchableOpacity
              style={[s.targetButton, editTarget === 'photo' && s.targetButtonActive, !photoUri && s.disabled]}
              disabled={!photoUri}
              onPress={() => setEditTarget('photo')}
            ><Text style={[s.targetText, editTarget === 'photo' && s.targetTextActive]}>사진</Text></TouchableOpacity>
            <TouchableOpacity style={[s.targetButton, editTarget === 'result' && s.targetButtonActive]} onPress={() => setEditTarget('result')}>
              <Text style={[s.targetText, editTarget === 'result' && s.targetTextActive]}>텍스트</Text>
            </TouchableOpacity>
          </View>
          <View style={s.colorSection}>
            <Text style={s.colorLabel}>텍스트 색상</Text>
            <View style={s.colorRow}>
              {TEXT_COLORS.map((item) => (
                <TouchableOpacity
                  key={item.value}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.label} 텍스트 색상`}
                  onPress={() => setTextColor(item.value)}
                  style={[s.colorButton, { backgroundColor: item.value }, textColor === item.value && s.colorButtonActive]}
                />
              ))}
            </View>
          </View>
          <View style={s.editActions}>
            <TouchableOpacity style={s.smallButton} onPress={pickPhoto}><Text style={s.smallButtonText}>{photoUri ? '사진 교체' : '사진 선택'}</Text></TouchableOpacity>
            {photoUri ? <TouchableOpacity style={s.smallButton} onPress={() => { setPhotoUri(null); photoLoadRef.current = null; photoTransform.reset(); setEditTarget('result'); }}><Text style={s.smallButtonText}>사진 제거</Text></TouchableOpacity> : null}
            <TouchableOpacity style={s.smallButton} onPress={editTarget === 'photo' ? photoTransform.reset : resultTransform.reset}><Text style={s.smallButtonText}>위치 초기화</Text></TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={s.actions}>
          <TouchableOpacity style={s.secondaryButton} onPress={saveImage} disabled={exporting}><Text style={s.secondaryButtonText}>사진에 저장</Text></TouchableOpacity>
          <TouchableOpacity style={s.primaryButton} onPress={shareImage} disabled={exporting}>
            {exporting ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryButtonText}>공유하기</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function Metric({ label, value, unit, onPhoto, textColor }: { label: string; value: string; unit?: string; onPhoto: boolean; textColor: string }) {
  return (
    <View style={s.metric}>
      <Text style={[s.metricLabel, onPhoto && s.onPhotoSecondary, { color: textColor }]}>{label}</Text>
      <Text style={[s.metricValue, onPhoto && s.onPhotoText, { color: textColor }]} numberOfLines={1} adjustsFontSizeToFit>{value}{unit ? <Text style={[s.metricUnit, onPhoto && s.onPhotoSecondary, { color: textColor }]}> {unit}</Text> : null}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.md, gap: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.background, padding: spacing.lg },
  error: { ...typography.body, textAlign: 'center' },
  backLink: { color: colors.primary, fontWeight: '700' },
  header: { height: 44, flexDirection: 'row', alignItems: 'center' },
  headerButton: { width: 64, height: 44, justifyContent: 'center' },
  headerButtonText: { fontSize: 36, lineHeight: 38, color: colors.text },
  title: { flex: 1, ...typography.heading, textAlign: 'center' },
  headerAction: { width: 64, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  headerActionText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  canvasRegion: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  composition: { overflow: 'hidden' },
  photoScrim: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.25)' },
  resultGroup: { flex: 1, padding: spacing.md, gap: spacing.sm, justifyContent: 'space-between' },
  brand: { alignSelf: 'flex-end', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  date: { fontSize: 11, fontWeight: '600', letterSpacing: 1.2, color: colors.textSecondary },
  time: { marginTop: 2, fontSize: 20, fontWeight: '700', color: colors.text },
  route: { flex: 1, minHeight: 80, overflow: 'hidden', borderRadius: radius.md },
  routeFallback: { backgroundColor: 'rgba(255,255,255,0.72)' },
  routeFallbackOnPhoto: { backgroundColor: 'rgba(0,0,0,0.22)' },
  noRoute: { ...typography.label, margin: 'auto' },
  heroLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: colors.textSecondary },
  heroValue: { fontSize: 46, lineHeight: 52, fontWeight: '800', letterSpacing: -1.5, color: colors.text },
  heroUnit: { fontSize: 18, fontWeight: '600', letterSpacing: 0, color: 'rgba(255,255,255,0.8)' },
  heroUnitPlain: { color: colors.textSecondary },
  metrics: { flexDirection: 'row', marginTop: spacing.sm },
  metric: { flex: 1, minWidth: 0 },
  metricLabel: { fontSize: 9, color: colors.textSecondary, marginBottom: 3 },
  metricValue: { fontSize: 15, fontWeight: '700', color: colors.text },
  metricUnit: { fontSize: 8, fontWeight: '500', color: colors.textSecondary },
  onPhotoText: { color: '#fff', textShadowColor: 'rgba(0,0,0,0.65)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  onPhotoSecondary: { color: 'rgba(255,255,255,0.75)', textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } },
  editor: { gap: spacing.sm },
  editorHint: { fontSize: 11, color: colors.textSecondary, textAlign: 'center' },
  colorSection: { alignItems: 'center', gap: 6 },
  colorLabel: { fontSize: 11, color: colors.textSecondary },
  colorRow: { flexDirection: 'row', gap: spacing.sm },
  colorButton: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(128,128,128,0.35)' },
  colorButtonActive: { borderWidth: 3, borderColor: colors.primary },
  targetRow: { flexDirection: 'row', alignSelf: 'center', padding: 3, borderRadius: radius.md, backgroundColor: colors.card },
  targetButton: { minWidth: 96, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: 9, alignItems: 'center' },
  targetButtonActive: { backgroundColor: colors.text },
  targetText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  targetTextActive: { color: '#fff' },
  disabled: { opacity: 0.35 },
  editActions: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  smallButton: { paddingHorizontal: spacing.sm, paddingVertical: 8 },
  smallButtonText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  actions: { flexDirection: 'row', gap: spacing.sm },
  secondaryButton: { flex: 1, height: 48, borderRadius: radius.md, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { fontSize: 15, fontWeight: '700', color: colors.text },
  primaryButton: { flex: 1, height: 48, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
