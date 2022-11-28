import { insertBatch, Lyra } from "@lyrasearch/lyra";
import glob from "glob";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { rehype } from "rehype";
import rehypePresetMinify from "rehype-preset-minify";
import { Content, Root, Parent, Element } from "hast";

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
  // TODO: stream
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

  if (node.type === "element" && typeof options?.transformFn === "function") {
    const preparedNode = prepareNode(node);
    const transformedNode = options.transformFn(preparedNode);
    applyTransform(node, transformedNode);
  }

  if (!("children" in node)) return;

  node.children.forEach((child, i) => {
    visitChildren(child, node, `${path}.${node.tagName}[${i}]`, records, options);
  });
}

function prepareNode(node: Element): NodeContent {
  return { tag: node.tagName, content: "", raw: "" };
}

function applyTransform(node: Element, transformedNode: NodeContent) {
  node.tagName = transformedNode.tag;
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
      if (!isRecordMergable(parentPath, type, records)) {
        records.push(newRecord);
        return;
      }
      addContentToLastRecord(records, content);
      return;
    case MergeStrategy.split:
      records.push(newRecord);
      return;
    case MergeStrategy.both:
      if (!isRecordMergable(parentPath, type, records)) {
        records.push(newRecord, { ...newRecord });
        return;
      }
      records.splice(records.length - 1, 0, newRecord);
      addContentToLastRecord(records, content);
      return;
  }
}

function isRecordMergable(path: string, tag: string, records: DefaultSchemaElement[]): boolean {
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
