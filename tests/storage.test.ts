import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  saveSource,
  getSource,
  listSources,
  saveTask,
  listTasks,
  deleteReference,
  type Task,
} from "../src/lib/storage";
import { defaults } from "../src/lib/processing";

test("deleting a reference removes persistent bytes, cancels pending jobs and preserves completed exports and unrelated sources", async () => {
  const source = "reference",
    other = "other";
  await saveSource(
    source,
    new File(["original"], "phone.mp4", { type: "video/mp4" }),
  );
  await saveSource(other, new File(["other"], "other.mp4"));
  const base = {
    sourceId: source,
    sourceName: "phone.mp4",
    variant: 1,
    index: 0,
    settings: { ...defaults },
    created: Date.now(),
  };
  const done: Task = {
    ...base,
    id: "done",
    state: "done",
    output: new Blob(["export"]),
    name: "result.mp4",
  };
  const waiting: Task = { ...base, id: "waiting", state: "queued" };
  const unrelated: Task = {
    ...base,
    id: "unrelated",
    sourceId: other,
    state: "queued",
  };
  await saveTask(done);
  await saveTask(waiting);
  await saveTask(unrelated);
  const changed = await deleteReference(source);
  assert.equal(changed.length, 2);
  assert.equal(await getSource(source), undefined);
  assert.equal(
    (await listSources()).some((s) => s.id === source),
    false,
  );
  assert(await getSource(other));
  const tasks = await listTasks(),
    finished = tasks.find((t) => t.id === "done")!;
  assert.equal(finished.state, "done");
  assert.equal(finished.sourceDeleted, true);
  assert.equal(await finished.output!.text(), "export");
  const cancelled = tasks.find((t) => t.id === "waiting")!;
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.sourceDeleted, true);
  assert.match(cancelled.error!, /Эталон удалён/);
  assert.equal(tasks.find((t) => t.id === "unrelated")!.state, "queued");
  assert.deepEqual((await deleteReference(source)).map((t) => t.id).sort(), [
    "done",
    "waiting",
  ]);
});
