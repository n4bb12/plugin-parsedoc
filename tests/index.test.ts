import t from "tap";
import { populateFromGlob, defaultHtmlSchema as schema } from "../src/index.js";
import { create, search } from "@lyrasearch/lyra";

t.test("it should store the values", async t => {
  const db = create({ schema });
  const filepath = "tests/fixtures/index.html";
  await populateFromGlob(db, filepath);
  t.strictSame(
    (await search(db, { term: "Test" })).hits.map(({ document }) => document),
    [{ id: `${filepath}/root[1].html[0].head[1]`, content: "Test", type: "title" }],
  );
});

t.test("when there are multiple consecutive elements with text with the same tag", async t => {
  await t.test("it should merge the values when the strategy is merge (default)", async t => {
    const db = create({ schema });
    await populateFromGlob(db, "tests/fixtures/two-paragraphs.html");
    t.equal(Object.values(db.docs).length, 1);
  });

  await t.test("it should keep records separated when the strategy is split", async t => {
    const db = create({ schema });
    await populateFromGlob(db, "tests/fixtures/two-paragraphs.html", { mergeStrategy: "split" });
    t.equal(Object.values(db.docs).length, 2);
  });

  await t.test("it should keep separated and merged records when the strategy is both", async t => {
    const db = create({ schema });
    await populateFromGlob(db, "tests/fixtures/two-paragraphs.html", { mergeStrategy: "both" });
    t.equal(Object.values(db.docs).length, 3);
  });
});

t.test("it should not merge records when a different tag element goes in between", async t => {
  const db = create({ schema });
  await populateFromGlob(db, "tests/fixtures/item-in-between.html");
  t.equal(Object.values(db.docs).length, 3);
});

t.test("it should not merge records when they belong to different containers", async t => {
  const db = create({ schema });
  await populateFromGlob(db, "tests/fixtures/different-containers.html");
  t.equal(Object.values(db.docs).length, 2);
});

t.test("it should change tags when specified in a transformFn", async t => {
  const db = create({ schema });
  const filepath = "tests/fixtures/h1.html";
  await populateFromGlob(db, filepath, {
    transformFn: node => (node.tag === "h1" ? { ...node, tag: "h2" } : node),
  });
  t.strictSame(Object.values(db.docs), [{ id: `${filepath}/root[0].html[1].body[0]`, content: "Heading", type: "h2" }]);
});

t.test("it should change the content when specified in a transformFn", async t => {
  const db = create({ schema });
  const filepath = "tests/fixtures/h1.html";
  await populateFromGlob(db, filepath, {
    transformFn: node => (node.tag === "h1" ? { ...node, content: "New content" } : node),
  });
  t.strictSame(Object.values(db.docs), [
    { id: `${filepath}/root[0].html[1].body[0]`, content: "New content", type: "h1" },
  ]);
});

t.test("it should change the raw content when specified in a transformFn", async t => {
  const db = create({ schema });
  const filepath = "tests/fixtures/h1.html";
  await populateFromGlob(db, filepath, {
    transformFn: node => (node.tag === "h1" ? { ...node, raw: "<div><p>Hello</p></div>" } : node),
  });
  t.strictSame(Object.values(db.docs), [
    { id: `${filepath}/root[0].html[1].body[0].div[0]`, content: "Hello", type: "p" },
  ]);
});

t.test("it should prioritize raw change over tag and content changes when both are specified", async t => {
  const db = create({ schema });
  const filepath = "tests/fixtures/h1.html";
  await populateFromGlob(db, filepath, {
    transformFn: node =>
      node.tag === "h1" ? { tag: "h2", content: "New content", raw: "<div><p>Hello</p></div>" } : node,
  });
  t.strictSame(Object.values(db.docs), [
    { id: `${filepath}/root[0].html[1].body[0].div[0]`, content: "Hello", type: "p" },
  ]);
});

t.test("it should parse markdown files", async t => {
  const db = create({ schema });
  const filepath = "tests/fixtures/markdown.md";
  await populateFromGlob(db, filepath);
  t.strictSame(Object.values(db.docs), [
    { id: `${filepath}/root[1].html[1].body[0]`, content: "Title", type: "h1" },
    { id: `${filepath}/root[1].html[1].body[1]`, content: "Some content", type: "p" },
    { id: `${filepath}/root[1].html[1].body[2]`, content: "Subtitle", type: "h2" },
    { id: `${filepath}/root[1].html[1].body[3]`, content: "Some more content", type: "p" },
  ]);
});
