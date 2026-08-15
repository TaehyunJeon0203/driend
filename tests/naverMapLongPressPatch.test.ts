/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const packageRoot = join(
  projectRoot,
  'node_modules/@mj-studio/react-native-naver-map',
);

function readProjectFile(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

function readPackageFile(relativePath: string): string {
  return readFileSync(join(packageRoot, relativePath), 'utf8');
}

describe('Naver map long-press bridge patch', () => {
  it('exposes the direct long-press event through source and declaration contracts', () => {
    // Given
    const nativeSpec = readPackageFile('src/spec/RNCNaverMapViewNativeComponent.ts');
    const component = readPackageFile('src/component/NaverMapView.tsx');
    const moduleRuntimeSpec = readPackageFile(
      'lib/module/spec/RNCNaverMapViewNativeComponent.ts',
    );
    const commonJsRuntimeSpec = readPackageFile(
      'lib/commonjs/spec/RNCNaverMapViewNativeComponent.ts',
    );
    const moduleRuntimeComponent = readPackageFile('lib/module/component/NaverMapView.js');
    const commonJsRuntimeComponent = readPackageFile('lib/commonjs/component/NaverMapView.js');
    const moduleDeclaration = readPackageFile(
      'lib/typescript/module/src/component/NaverMapView.d.ts',
    );
    const commonJsDeclaration = readPackageFile(
      'lib/typescript/commonjs/src/component/NaverMapView.d.ts',
    );

    // When
    const bridgeSources = [
      nativeSpec,
      component,
      moduleRuntimeSpec,
      commonJsRuntimeSpec,
      moduleRuntimeComponent,
      commonJsRuntimeComponent,
      moduleDeclaration,
      commonJsDeclaration,
    ];

    // Then
    for (const source of bridgeSources) {
      expect(source).toContain('onLongPressMap');
    }
    expect(nativeSpec).toMatch(
      /onLongPressMap\?: DirectEventHandler<[\s\S]*?latitude: Double;[\s\S]*?longitude: Double;[\s\S]*?x: Double;[\s\S]*?y: Double;/,
    );
    expect(component).toContain('onLongPressMap: onLongPressMapProp');
    expect(component).toContain('const onLongPressMap = useStableCallback(');
    expect(component).toContain(
      'onLongPressMap={onLongPressMapProp ? onLongPressMap : undefined}',
    );
    for (const runtimeComponent of [moduleRuntimeComponent, commonJsRuntimeComponent]) {
      expect(runtimeComponent).toContain('onLongPressMap: onLongPressMapProp');
      expect(runtimeComponent).toContain('onLongPressMapProp?.({');
      expect(runtimeComponent).toContain(
        'onLongPressMap: onLongPressMapProp ? onLongPressMap : undefined',
      );
    }
  });

  it('registers and emits one non-coalescing Android long-press event', () => {
    // Given
    const event = readPackageFile(
      'android/src/main/java/com/mjstudio/reactnativenavermap/event/NaverMapLongPressEvent.kt',
    );
    const manager = readPackageFile(
      'android/src/main/java/com/mjstudio/reactnativenavermap/mapview/RNCNaverMapViewManager.kt',
    );
    const mapView = readPackageFile(
      'android/src/main/java/com/mjstudio/reactnativenavermap/mapview/RNCNaverMapView.kt',
    );

    // When / Then
    expect(event).toContain('const val EVENT_NAME = "topLongPressMap"');
    expect(event).toContain('override fun canCoalesce(): Boolean = false');
    expect(manager).toContain('registerDirectEvent(this, NaverMapLongPressEvent.EVENT_NAME)');
    expect(mapView).toContain('setOnMapLongClickListener');
    expect(mapView).toContain('NaverMapLongPressEvent(');
  });

  it('emits the matching iOS event from the native long-tap delegate', () => {
    // Given / When
    const implementation = readPackageFile('ios/RNCNaverMapViewImpl.mm');

    // Then
    expect(implementation).toContain('didLongTapMap:');
    expect(implementation).toContain('_rncParent.emitter->onLongPressMap({');
    expect(implementation).toMatch(
      /onLongPressMap\(\{[\s\S]*?\.latitude = latlng\.lat,[\s\S]*?\.longitude = latlng\.lng,[\s\S]*?\.x = point\.x,[\s\S]*?\.y = point\.y,/,
    );
  });

  it('binds direct coordinates only in photo mode without a parent RNGH gesture', () => {
    // Given / When
    const mapScreen = readProjectFile('app/(tabs)/index.tsx');

    // Then
    expect(mapScreen).toContain(
      "onLongPressMap={mapMode === 'photo' ? handleMapLongPress : undefined}",
    );
    expect(mapScreen).toMatch(
      /handleMapLongPress = \(\{ latitude, longitude \}: LatLng\)/,
    );
    expect(mapScreen).not.toContain('LongPressGestureHandler');
    expect(mapScreen).not.toContain('screenToCoordinate({');
  });
});
