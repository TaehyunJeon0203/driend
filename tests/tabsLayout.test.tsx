import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { Ionicons, Tabs, TabsScreen } = vi.hoisted(() => {
  const Screen = vi.fn(() => null);
  return {
    Ionicons: vi.fn(() => null),
    Tabs: Object.assign(vi.fn(({ children }: { readonly children?: ReactNode }) => children), {
      Screen,
    }),
    TabsScreen: Screen,
  };
});

vi.mock('expo-router', () => ({ Tabs }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: Ionicons }));

import TabsLayout from '../app/(tabs)/_layout';

type ScreenProps = {
  readonly name: unknown;
  readonly options: unknown;
};

type ScreenOptions = {
  readonly title: unknown;
  readonly tabBarIcon: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isScreenElement(node: ReactNode): node is ReactElement<ScreenProps> {
  return isValidElement(node)
    && node.type === TabsScreen
    && isRecord(node.props)
    && 'name' in node.props
    && 'options' in node.props;
}

function isScreenOptions(value: unknown): value is ScreenOptions {
  return isRecord(value) && 'title' in value && 'tabBarIcon' in value;
}

function getScreens(): readonly ReactElement<ScreenProps>[] {
  const layout = TabsLayout();
  expect(layout.type).toBe(Tabs);
  return Children.toArray(layout.props.children).filter(isScreenElement);
}

describe('TabsLayout', () => {
  it('keeps the four routes and Korean labels in navigation order', () => {
    // Given / When
    const screens = getScreens();

    // Then
    expect(screens.map(({ props }) => props.name)).toEqual([
      'index',
      'ranking',
      'stats',
      'profile',
    ]);
    expect(screens.map(({ props }) => {
      if (!isRecord(props.options)) return undefined;
      return props.options.title;
    })).toEqual(['지도', '랭킹', '통계', '프로필']);
  });

  it.each([
    ['index', 'map', 'map-outline'],
    ['ranking', 'trophy', 'trophy-outline'],
    ['stats', 'stats-chart', 'stats-chart-outline'],
    ['profile', 'person', 'person-outline'],
  ])('renders focus-aware %s icons with navigator color and size', (route, focusedName, inactiveName) => {
    // Given
    const screen = getScreens().find(({ props }) => props.name === route);
    if (!screen || !isScreenOptions(screen.props.options)) {
      throw new Error(`Missing tab options for ${route}`);
    }
    const { tabBarIcon } = screen.props.options;
    if (typeof tabBarIcon !== 'function') {
      throw new Error(`Missing tab icon for ${route}`);
    }

    // When
    const focusedIcon = tabBarIcon({ focused: true, color: 'focused-color', size: 31 });
    const inactiveIcon = tabBarIcon({ focused: false, color: 'inactive-color', size: 23 });

    // Then
    expect(isValidElement(focusedIcon) && focusedIcon.type).toBe(Ionicons);
    expect(isValidElement(focusedIcon) && focusedIcon.props).toMatchObject({
      name: focusedName,
      color: 'focused-color',
      size: 31,
    });
    expect(isValidElement(inactiveIcon) && inactiveIcon.type).toBe(Ionicons);
    expect(isValidElement(inactiveIcon) && inactiveIcon.props).toMatchObject({
      name: inactiveName,
      color: 'inactive-color',
      size: 23,
    });
  });
});
