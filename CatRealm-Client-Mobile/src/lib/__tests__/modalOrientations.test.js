/** @jest-environment node */
const { readdirSync, readFileSync } = require('node:fs');
const { resolve, relative } = require('node:path');
const { test, expect } = require('@jest/globals');
const ts = require('typescript');

const root = resolve(__dirname, '../../..');
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__') return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.[jt]sx$/.test(path) ? [path] : [];
  });
}

// JS render tests cannot trigger UIKit's Release-only orientation exception.
// Inspect actual JSX props so a new portrait-default modal cannot silently ship.
function modalDeclarations(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== 'react-native') continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        if ((binding.propertyName ?? binding.name).text === 'Modal') names.add(binding.name.text);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      names.add(`${bindings.name.text}.Modal`);
    }
  }
  const declarations = [];
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && names.has(node.tagName.getText(source))) {
      const attribute = node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.text === 'supportedOrientations');
      const expression = attribute?.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : null;
      const orientations = expression && ts.isArrayLiteralExpression(expression)
        ? expression.elements.filter(ts.isStringLiteral).map((element) => element.text) : [];
      declarations.push({
        location: `${relative(root, path)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        orientations,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return declarations;
}

const modals = ['app', 'src'].flatMap((directory) => sourceFiles(resolve(root, directory)))
  .flatMap((path) => modalDeclarations(path, readFileSync(path, 'utf8')));

test('the orientation audit discovers the theater and incoming-call modals', () => {
  expect(modals.some(({ location }) => location.includes('/theater/[channelId].tsx:'))).toBe(true);
  expect(modals.some(({ location }) => location.includes('/CallOverlay.tsx:'))).toBe(true);
});

test.each(modals)('$location supports portrait and both landscape locks', ({ orientations }) => {
  expect(orientations).toEqual(expect.arrayContaining(['portrait', 'portrait-upside-down']));
  expect(orientations.includes('landscape') ||
    (orientations.includes('landscape-left') && orientations.includes('landscape-right'))).toBe(true);
});

test('the audit detects omitted orientations even with an aliased Modal import', () => {
  const result = modalDeclarations('regression.tsx', "import { Modal as Dialog } from 'react-native'; const view = <Dialog visible />;");
  expect(result).toHaveLength(1);
  expect(result[0].orientations).toEqual([]);
});
