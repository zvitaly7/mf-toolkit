import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { IconUsage } from '../../types.js';

export async function parseFileImports(
  filePath: string,
  iconPattern: RegExp,
  extractNamed = false,
): Promise<IconUsage[]> {
  const babel = await import('@babel/parser');
  const raw = await readFile(filePath, 'utf-8');

  const ext = extname(filePath);
  const plugins: any[] = ['decorators'];
  if (ext === '.ts' || ext === '.tsx') plugins.push('typescript');
  if (ext === '.jsx' || ext === '.tsx') plugins.push('jsx');

  const ast = babel.parse(raw, {
    sourceType: 'module',
    plugins,
    errorRecovery: true,
  });

  const results: IconUsage[] = [];

  // First pass: set parent references for dynamic import context detection
  setParents(ast.program);

  for (const node of ast.program.body) {
    visit(node);
  }

  return results;

  function visit(node: any): void {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'ImportDeclaration' && node.source?.value) {
      // Skip type-only imports: import type { X } from 'mod'
      if (node.importKind !== 'type') processStaticImport(node);
    }

    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source?.value) {
      // Skip type-only exports: export type { X } from 'mod'
      if (node.exportKind !== 'type') processExport(node);
    }

    if (node.type === 'CallExpression') {
      processCallExpression(node);
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === '_parent' ||
          key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item.type === 'string') visit(item);
        }
      } else if (child && typeof child.type === 'string') {
        visit(child);
      }
    }
  }

  function processStaticImport(node: any): void {
    const specifier = node.source.value;
    const line = node.loc?.start?.line ?? 0;

    iconPattern.lastIndex = 0;
    const iconMatch = iconPattern.exec(specifier);
    if (!iconMatch) return;

    if (extractNamed) {
      const prefix = iconMatch[1] || '';
      for (const spec of node.specifiers ?? []) {
        // Skip inline type specifiers: import { type X, Y } → only Y
        if (spec.type === 'ImportSpecifier' && spec.importKind !== 'type') {
          const name = spec.imported.name ?? spec.imported.value;
          results.push({ name: prefix ? `${prefix}/${name}` : name, source: filePath, line });
        }
      }
    } else if (iconMatch[1]) {
      results.push({ name: iconMatch[1], source: filePath, line });
    }
  }

  function processExport(node: any): void {
    const specifier = node.source.value;
    const line = node.loc?.start?.line ?? 0;

    iconPattern.lastIndex = 0;
    const iconMatch = iconPattern.exec(specifier);
    if (!iconMatch) return;

    if (extractNamed) {
      const prefix = iconMatch[1] || '';
      for (const spec of node.specifiers ?? []) {
        // Skip inline type specifiers: export { type X, Y } → only Y
        if (spec.type === 'ExportSpecifier' && spec.exportKind !== 'type') {
          const name = spec.local.name ?? spec.local.value;
          results.push({ name: prefix ? `${prefix}/${name}` : name, source: filePath, line });
        }
      }
    } else if (iconMatch[1]) {
      results.push({ name: iconMatch[1], source: filePath, line });
    }
  }

  function processCallExpression(node: any): void {
    const isDynamic = node.callee?.type === 'Import';
    const isRequire = node.callee?.type === 'Identifier' && node.callee.name === 'require';

    if (!(isDynamic || isRequire) || !node.arguments?.[0] || node.arguments[0].type !== 'StringLiteral') return;

    const specifier = node.arguments[0].value;
    const line = node.loc?.start?.line ?? 0;

    iconPattern.lastIndex = 0;
    const iconMatch = iconPattern.exec(specifier);
    if (!iconMatch) return;

    if (extractNamed) {
      const prefix = iconMatch[1] || '';
      const names = extractDynamicNames(node);
      for (const name of names) {
        results.push({ name: prefix ? `${prefix}/${name}` : name, source: filePath, line });
      }
    } else if (iconMatch[1]) {
      results.push({ name: iconMatch[1], source: filePath, line });
    }
  }
}

function extractDynamicNames(callNode: any): string[] {
  const names: string[] = [];
  const parent = callNode._parent;

  // Pattern: const { A, B } = await import('mod')
  // AST: VariableDeclarator > AwaitExpression > CallExpression
  if (parent?.type === 'AwaitExpression') {
    const varDecl = parent._parent;
    if (varDecl?.type === 'VariableDeclarator' && varDecl.id?.type === 'ObjectPattern') {
      for (const prop of varDecl.id.properties) {
        if (prop.type === 'ObjectProperty') {
          const name = prop.key?.name ?? prop.key?.value;
          if (name && !names.includes(name)) names.push(name);
        }
      }
      return names;
    }
  }

  // Pattern: import('mod').then(callback)
  // AST: CallExpression(.then) > MemberExpression > CallExpression(import)
  if (parent?.type === 'MemberExpression' && parent.property?.name === 'then') {
    const thenCall = parent._parent;
    if (thenCall?.type === 'CallExpression' && thenCall.arguments?.length > 0) {
      const callback = thenCall.arguments[0];
      if (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') {
        const params = callback.params;
        if (params?.length > 0) {
          const param = params[0];

          // .then(({ A, B }) => ...)
          if (param.type === 'ObjectPattern') {
            for (const prop of param.properties) {
              if (prop.type === 'ObjectProperty') {
                const name = prop.key?.name ?? prop.key?.value;
                if (name && !names.includes(name)) names.push(name);
              }
            }
            return names;
          }

          // .then((m) => m.A) or .then(m => ({ default: m.A }))
          if (param.type === 'Identifier') {
            collectMemberAccesses(callback.body, param.name, names);
            return names;
          }
        }
      }
    }
  }

  return names;
}

function collectMemberAccesses(node: any, paramName: string, names: string[]): void {
  if (!node || typeof node !== 'object') return;

  if (node.type === 'MemberExpression' && node.object?.type === 'Identifier' &&
      node.object.name === paramName && node.property?.name) {
    const name = node.property.name;
    if (/^[A-Z]/.test(name) && !names.includes(name)) names.push(name);
  }

  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === '_parent') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item.type === 'string') collectMemberAccesses(item, paramName, names);
      }
    } else if (child && typeof child.type === 'string') {
      collectMemberAccesses(child, paramName, names);
    }
  }
}

function setParents(node: any, parent?: any): void {
  if (!node || typeof node !== 'object') return;
  if (parent) node._parent = parent;

  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === '_parent' ||
        key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item.type === 'string') setParents(item, node);
      }
    } else if (child && typeof child.type === 'string') {
      setParents(child, node);
    }
  }
}
