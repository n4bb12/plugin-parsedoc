import { insertBatch, Lyra } from "@lyrasearch/lyra";
import glob from "glob";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { rehype } from "rehype";
import rehypePresetMinify from "rehype-preset-minify";
import { Content, Root, Parent, Element, Text } from "hast";
import { toHtml } from "hast-util-to-html";
import { fromHtml } from "hast-util-from-html";

export enum MergeStrategy {
  merge = "merge",
  split = "split",
  both = "both",
}

export const defaultHtmlSchema = {
  type: "string",
  content: "string",
  id: "string",
} as const;

type DefaultSchemaElement = {
  type: string;
  content: string;
  id: string;
};

type PluginOptions = {
  transformFn?: TransformFn;
  mergeStrategy?: MergeStrategy;
};
const asyncGlob = promisify(glob);

export const populateFromGlob = async (
  db: Lyra<typeof defaultHtmlSchema>,
  pattern: string,
  options?: PluginOptions,
): Promise<void> => {
  const files = await asyncGlob(pattern);
  await Promise.all(files.map(filename => populateFromFile(db, filename, options)));
  return;
};

const populateFromFile = async (db: LyraInstance, filename: string, options?: PluginOptions): Promise<void> => {
  const data = await readFile(filename);
  return populate(db, data, options);
};

type LyraInstance = Lyra<typeof defaultHtmlSchema>;

const populate = async (
  db: LyraInstance,
  data: Buffer,
  options?: {
    transformFn?: TransformFn;
    mergeStrategy?: MergeStrategy;
  },
): Promise<void> => {
  const records: DefaultSchemaElement[] = [];
  rehype().use(rehypePresetMinify).use(rehypeLyra, records, options).process(data);
  return insertBatch(db, records);
};

export function rehypeLyra(records: DefaultSchemaElement[], options?: PluginOptions) {
  return (tree: Root) => {
    tree.children.forEach((child, i) => visitChildren(child, tree, `root[${i}]`, records, options));
  };
}

function visitChildren(
  node: Content,
  parent: Parent,
  path: string,
  records: DefaultSchemaElement[],
  options?: PluginOptions,
) {
  if (node.type === "text") {
    addRecords(node.value, (parent as Element).tagName, path, records, options?.mergeStrategy ?? MergeStrategy.merge);
    return;
  }

  if (!("children" in node)) return;

  const transformedNode = typeof options?.transformFn === "function" ? applyTransform(node, options.transformFn) : node;

  transformedNode.children.forEach((child, i) => {
    visitChildren(child, transformedNode, `${path}.${transformedNode.tagName}[${i}]`, records, options);
  });
}

function applyTransform(node: Element, transformFn: TransformFn): Element {
  const preparedNode = prepareNode(node);
  const transformedNode = transformFn(preparedNode);
  return applyChanges(node, transformedNode);
}

function prepareNode(node: Element): NodeContent {
  const tag = node.tagName;
  const content = isContentNode(node) ? (node.children[0] as Text).value : "";
  const raw = toHtml(node);
  return { tag, content, raw };
}

function isContentNode(node: Element): boolean {
  return node.children.length === 1 && node.children[0].type === "text";
}

function applyChanges(node: Element, transformedNode: NodeContent): Element {
  if (toHtml(node) !== transformedNode.raw)
    return fromHtml(transformedNode.raw, { fragment: true }).children[0] as Element;
  node.tagName = transformedNode.tag;
  if (isContentNode(node)) (node.children[0] as Text).value = transformedNode.content;
  return node;
}

function addRecords(
  content: string,
  type: string,
  path: string,
  records: DefaultSchemaElement[],
  mergeStrategy: MergeStrategy,
) {
  const parentPath = path.substring(0, path.lastIndexOf("."));
  const newRecord = { type, content, id: parentPath };
  switch (mergeStrategy) {
    case MergeStrategy.merge:
      if (!isRecordMergeable(parentPath, type, records)) {
        records.push(newRecord);
        return;
      }
      addContentToLastRecord(records, content);
      return;
    case MergeStrategy.split:
      records.push(newRecord);
      return;
    case MergeStrategy.both:
      if (!isRecordMergeable(parentPath, type, records)) {
        records.push(newRecord, { ...newRecord });
        return;
      }
      records.splice(records.length - 1, 0, newRecord);
      addContentToLastRecord(records, content);
      return;
  }
}

function isRecordMergeable(path: string, tag: string, records: DefaultSchemaElement[]): boolean {
  if (!records.length) return false;
  const lastRecord = records[records.length - 1];
  const parentPath = pathWithoutLastIndex(path);
  const lastPath = pathWithoutLastIndex(lastRecord.id);
  return parentPath === lastPath && tag === lastRecord.type;
}

function pathWithoutLastIndex(path: string): string {
  const lastBracket = path.lastIndexOf("[");
  return path.slice(0, lastBracket);
}

function addContentToLastRecord(records: DefaultSchemaElement[], content: string) {
  records[records.length - 1].content += ` ${content}`;
}

export type NodeContent = {
  tag: string;
  raw: string;
  content: string;
};

export type TransformFn = (node: NodeContent) => NodeContent;
