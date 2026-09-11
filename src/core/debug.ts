/**
 * 调试工具：把页面 DOM 简化为结构骨架，用于给开发者校准适配器选择器。
 * 只保留标签名 / id / class / 叶子节点的文本片段，避免整页噪音。
 */
export interface SkeletonNode {
  tag: string;
  id?: string;
  cls?: string;
  text?: string;
  children?: SkeletonNode[];
}

export function domSkeleton(root: Element = document.body, maxDepth = 8, maxNodes = 500): SkeletonNode {
  let count = 0;

  function walk(el: Element, depth: number): SkeletonNode | null {
    if (depth > maxDepth || count++ > maxNodes) return null;
    const node: SkeletonNode = { tag: el.tagName.toLowerCase() };
    if (el.id) node.id = el.id;
    if (typeof el.className === 'string' && el.className) node.cls = el.className.slice(0, 200);

    const children: SkeletonNode[] = [];
    for (const child of Array.from(el.children)) {
      const c = walk(child, depth + 1);
      if (c) children.push(c);
    }

    if (children.length === 0) {
      const t = el.textContent?.trim();
      if (t) node.text = t.slice(0, 200);
    } else {
      node.children = children;
    }
    return node;
  }

  return walk(root, 0) ?? { tag: 'empty' };
}
