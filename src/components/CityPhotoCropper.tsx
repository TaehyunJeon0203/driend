import { useRef, useState } from 'react';
import { Modal, View, StyleSheet, Image, TouchableOpacity, Text, Animated, Dimensions } from 'react-native';
import {
  PinchGestureHandler, PanGestureHandler, State,
  type PinchGestureHandlerEventPayload, type PanGestureHandlerEventPayload,
  type HandlerStateChangeEvent,
} from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';
import ViewShot, { type ViewShotRef } from 'react-native-view-shot';
import { bboxOfPolygons } from '../services/geo';
import { colors } from '../theme';

type LatLng = { latitude: number; longitude: number };

const SCREEN_W = Dimensions.get('window').width;
const FRAME_MAX_W = SCREEN_W * 0.86;
const FRAME_MAX_H = FRAME_MAX_W * 1.3;

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

export default function CityPhotoCropper({
  visible,
  imageUri,
  polygons,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  imageUri: string | null;
  polygons: LatLng[][];
  onCancel: () => void;
  onConfirm: (croppedUri: string) => void;
}) {
  const [frameSize, setFrameSize] = useState({ w: FRAME_MAX_W, h: FRAME_MAX_H });
  const viewShotRef = useRef<ViewShotRef>(null);

  const baseScale = useRef(new Animated.Value(1)).current;
  const pinchScale = useRef(new Animated.Value(1)).current;
  const lastScale = useRef(1);

  const baseTranslate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const panTranslate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const lastTranslate = useRef({ x: 0, y: 0 });

  const scale = Animated.multiply(baseScale, pinchScale);
  const translateX = Animated.add(baseTranslate.x, panTranslate.x);
  const translateY = Animated.add(baseTranslate.y, panTranslate.y);

  if (!visible || !imageUri) return null;

  const { minLat, maxLat, minLng, maxLng } = bboxOfPolygons(polygons);
  const avgLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const geoW = (maxLng - minLng) * Math.cos(avgLatRad);
  const geoH = maxLat - minLat;
  const aspect = geoW / geoH;

  let frameW = FRAME_MAX_W;
  let frameH = frameW / aspect;
  if (frameH > FRAME_MAX_H) {
    frameH = FRAME_MAX_H;
    frameW = frameH * aspect;
  }
  if (frameSize.w !== frameW || frameSize.h !== frameH) {
    setFrameSize({ w: frameW, h: frameH });
  }

  const guidePath = buildGuidePath(polygons, { minLat, maxLat, minLng, maxLng }, frameW, frameH);
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
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={s.overlay}>
        <Text style={s.title}>사진을 원하는 위치로 옮기고 확대/축소하세요</Text>

        <View style={[s.frameWrap, { width: frameW, height: frameH }]}>
          <ViewShot ref={viewShotRef} style={{ width: frameW, height: frameH }} options={{ format: 'png', quality: 1 }}>
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

        <View style={s.btnRow}>
          <TouchableOpacity style={s.cancelBtn} onPress={onCancel}>
            <Text style={s.cancelText}>취소</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.confirmBtn} onPress={handleConfirm}>
            <Text style={s.confirmText}>완료</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 14, marginBottom: 20, paddingHorizontal: 24, textAlign: 'center' },
  frameWrap: { overflow: 'hidden', backgroundColor: '#111', borderRadius: 8 },
  frame: { overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  btnRow: { flexDirection: 'row', gap: 16, marginTop: 28 },
  cancelBtn: { paddingHorizontal: 28, paddingVertical: 12, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)' },
  cancelText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  confirmBtn: { paddingHorizontal: 28, paddingVertical: 12, borderRadius: 20, backgroundColor: colors.primary },
  confirmText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
