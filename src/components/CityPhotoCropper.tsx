import { useEffect, useRef, useState } from 'react';
import {
  Modal, View, StyleSheet, Image, TouchableOpacity, Text, Animated,
  type LayoutChangeEvent,
} from 'react-native';
import {
  PinchGestureHandler, PanGestureHandler, State,
  type PinchGestureHandlerEventPayload, type PanGestureHandlerEventPayload,
  type HandlerStateChangeEvent,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import ViewShot, { type ViewShotRef } from 'react-native-view-shot';
import { bboxOfPolygons } from '../services/geo';
import { colors } from '../theme';
import {
  fitAspectFrame,
  resizeTranslation,
  TAB_CONTENT_MAX_WIDTH,
  type FrameSize,
} from '../utils/responsiveLayout';

type LatLng = { latitude: number; longitude: number };

/** 위경도 폴리곤을 프레임 픽셀 좌표계의 SVG path로 변환 (경도는 위도 보정) */
function buildGuidePath(polygons: LatLng[][], bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }, w: number, h: number): string {
  const { minLat, maxLat, minLng, maxLng } = bbox;
  const toXY = (pt: LatLng) => {
    const x = ((pt.longitude - minLng) / (maxLng - minLng)) * w;
    const y = ((maxLat - pt.latitude) / (maxLat - minLat)) * h;
    return [x, y];
  };
  return polygons
    .map((ring) => ring.map((pt, i) => `${i === 0 ? 'M' : 'L'}${toXY(pt).join(',')}`).join(' ') + 'Z')
    .join(' ');
}

type CropperProps = {
  visible: boolean;
  imageUri: string | null;
  polygons: LatLng[][];
  onCancel: () => void;
  onConfirm: (croppedUri: string) => void;
};

// Modal 안에 다른 Modal을 중첩해서 열고 닫는 컴포넌트(CityPhotoGallery 등)에서 쓰기 위한,
// <Modal> 래퍼가 없는 버전 — 네이티브 모달 전환이 겹치면 iOS에서 먹통이 되는 문제 회피용
export function CityPhotoCropperContent({
  visible,
  imageUri,
  polygons,
  onCancel,
  onConfirm,
}: CropperProps) {
  const insets = useSafeAreaInsets();
  const [frameRegion, setFrameRegion] = useState<FrameSize>({ width: 0, height: 0 });
  const viewShotRef = useRef<ViewShotRef>(null);
  const previousFrameRef = useRef<FrameSize>({ width: 0, height: 0 });

  const baseScale = useRef(new Animated.Value(1)).current;
  const pinchScale = useRef(new Animated.Value(1)).current;
  const lastScale = useRef(1);

  const baseTranslate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const panTranslate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const lastTranslate = useRef({ x: 0, y: 0 });

  const scale = Animated.multiply(baseScale, pinchScale);
  const translateX = Animated.add(baseTranslate.x, panTranslate.x);
  const translateY = Animated.add(baseTranslate.y, panTranslate.y);

  const geometry = visible && imageUri && polygons.length > 0
    ? (() => {
        const bbox = bboxOfPolygons(polygons);
        const avgLatRad = ((bbox.minLat + bbox.maxLat) / 2) * (Math.PI / 180);
        const geoW = (bbox.maxLng - bbox.minLng) * Math.cos(avgLatRad);
        const geoH = bbox.maxLat - bbox.minLat;
        return { bbox, aspect: geoW / geoH };
      })()
    : null;
  const frame = fitAspectFrame({
    aspect: geometry?.aspect ?? 0,
    availableWidth: frameRegion.width,
    availableHeight: frameRegion.height,
  });

  useEffect(() => {
    if (frame.width <= 0 || frame.height <= 0) return;

    const previousFrame = previousFrameRef.current;
    if (
      previousFrame.width > 0 && previousFrame.height > 0 &&
      (previousFrame.width !== frame.width || previousFrame.height !== frame.height)
    ) {
      const translation = resizeTranslation(lastTranslate.current, previousFrame, frame);
      lastTranslate.current = translation;
      baseTranslate.setValue(translation);
      panTranslate.setValue({ x: 0, y: 0 });
    }
    previousFrameRef.current = frame;
  }, [baseTranslate, frame.height, frame.width, panTranslate]);

  if (!geometry || !imageUri) return null;

  const frameW = frame.width;
  const frameH = frame.height;

  const guidePath = buildGuidePath(polygons, geometry.bbox, frameW, frameH);
  const outerPath = `M0,0 L${frameW},0 L${frameW},${frameH} L0,${frameH} Z`;

  const onPinchEvent = Animated.event([{ nativeEvent: { scale: pinchScale } }], { useNativeDriver: true });
  const onPinchStateChange = (e: HandlerStateChangeEvent<PinchGestureHandlerEventPayload>) => {
    if (e.nativeEvent.oldState === State.ACTIVE) {
      lastScale.current = Math.max(0.5, Math.min(6, lastScale.current * e.nativeEvent.scale));
      baseScale.setValue(lastScale.current);
      pinchScale.setValue(1);
    }
  };

  const onPanEvent = Animated.event(
    [{ nativeEvent: { translationX: panTranslate.x, translationY: panTranslate.y } }],
    { useNativeDriver: true }
  );
  const onPanStateChange = (e: HandlerStateChangeEvent<PanGestureHandlerEventPayload>) => {
    if (e.nativeEvent.oldState === State.ACTIVE) {
      lastTranslate.current = {
        x: lastTranslate.current.x + e.nativeEvent.translationX,
        y: lastTranslate.current.y + e.nativeEvent.translationY,
      };
      baseTranslate.setValue(lastTranslate.current);
      panTranslate.setValue({ x: 0, y: 0 });
    }
  };

  const handleConfirm = async () => {
    if (!viewShotRef.current?.capture) return;
    const uri = await viewShotRef.current.capture();
    onConfirm(uri);
  };

  return (
    <View
      style={[
        s.overlay,
        { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 },
      ]}
    >
      <View style={s.controlContent}>
        <Text style={s.title}>사진을 원하는 위치로 옮기고 확대/축소하세요</Text>
      </View>

      <View
        style={s.frameRegion}
        onLayout={(event: LayoutChangeEvent) => {
          const { width, height } = event.nativeEvent.layout;
          setFrameRegion((current) => current.width === width && current.height === height
            ? current
            : { width, height });
        }}
      >
      {frameW > 0 && frameH > 0 && (
        <View style={[s.frameWrap, { width: frameW, height: frameH }]}>
        {/* PNG로 캡처하면 일부 기기(광색역 디스플레이)에서 16비트 PNG가 나와 서버(Jimp)가
            못 읽는 문제가 있었음. 이 단계는 투명도가 필요 없어(마스킹은 서버에서 함) JPEG로 캡처 */}
        <ViewShot ref={viewShotRef} style={{ width: frameW, height: frameH }} options={{ format: 'jpg', quality: 0.92 }}>
          <View style={[s.frame, { width: frameW, height: frameH }]}>
            <PanGestureHandler onGestureEvent={onPanEvent} onHandlerStateChange={onPanStateChange} minPointers={1} maxPointers={2}>
              <Animated.View style={StyleSheet.absoluteFill}>
                <PinchGestureHandler onGestureEvent={onPinchEvent} onHandlerStateChange={onPinchStateChange}>
                  <Animated.View style={StyleSheet.absoluteFill}>
                    <Animated.Image
                      source={{ uri: imageUri }}
                      style={[
                        s.image,
                        { transform: [{ translateX }, { translateY }, { scale }] },
                      ]}
                      resizeMode="cover"
                    />
                  </Animated.View>
                </PinchGestureHandler>
              </Animated.View>
            </PanGestureHandler>
          </View>
        </ViewShot>

        <Svg width={frameW} height={frameH} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d={`${outerPath} ${guidePath}`} fill="rgba(0,0,0,0.55)" fillRule="evenodd" />
          <Path d={guidePath} fill="none" stroke="#fff" strokeWidth={2} />
        </Svg>
        </View>
      )}
      </View>

      <View style={s.controlContent}>
        <View style={s.btnRow}>
          <TouchableOpacity style={s.cancelBtn} onPress={onCancel}>
            <Text style={s.cancelText}>취소</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.confirmBtn} onPress={handleConfirm}>
            <Text style={s.confirmText}>완료</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// 단독으로 쓰는 화면(stats.tsx 등)을 위한 기본 export — 자체 <Modal>로 감쌈
export default function CityPhotoCropper(props: CropperProps) {
  if (!props.visible || !props.imageUri || !props.polygons.length) return null;
  return (
    <Modal visible={props.visible} animationType="fade" transparent onRequestClose={props.onCancel}>
      <CityPhotoCropperContent {...props} />
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000', alignItems: 'center' },
  controlContent: { width: '100%', maxWidth: TAB_CONTENT_MAX_WIDTH, alignItems: 'center' },
  title: { color: '#fff', fontSize: 14, paddingHorizontal: 24, textAlign: 'center' },
  frameRegion: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  frameWrap: { overflow: 'hidden', backgroundColor: '#111', borderRadius: 8 },
  frame: { overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  btnRow: { flexDirection: 'row', gap: 16, marginTop: 28 },
  cancelBtn: { paddingHorizontal: 28, paddingVertical: 12, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)' },
  cancelText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  confirmBtn: { paddingHorizontal: 28, paddingVertical: 12, borderRadius: 20, backgroundColor: colors.primary },
  confirmText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
