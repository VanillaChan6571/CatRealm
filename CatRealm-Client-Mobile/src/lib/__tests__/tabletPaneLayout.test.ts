import { tabletRightPaneDocked } from '../tabletPaneLayout';

const LEFT = 346;

test('docks the right pane beside the chat in tablet landscape', () => {
  expect(tabletRightPaneDocked(1393, LEFT)).toBe(true); // 10-inch landscape
  expect(tabletRightPaneDocked(1280, LEFT)).toBe(true);
});

test('overlays the right pane when docking would squeeze the chat', () => {
  expect(tabletRightPaneDocked(784, LEFT)).toBe(false); // 10-inch portrait
  expect(tabletRightPaneDocked(820, LEFT)).toBe(false); // iPad Air portrait
});

test('docks once the chat keeps its minimum width', () => {
  expect(tabletRightPaneDocked(LEFT + 280 + 360, LEFT)).toBe(true);
  expect(tabletRightPaneDocked(LEFT + 280 + 359, LEFT)).toBe(false);
});
