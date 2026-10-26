// oxlint-disable import/no-namespace
import { test, describe, expectTypeOf } from "vite-plus/test";

import * as contextTypes from "../src/context.types.js";
import * as embTypes from "../src/emb.types.js";
import * as dbErrors from "../src/errors/db-errors.js";
import * as embErrors from "../src/errors/emb-errors.js";
import * as errors from "../src/errors/errors.js";
import * as dbTypes from "../src/idx.types.js";
import * as core from "../src/index.js";
import * as objectTypes from "../src/object.types.js";

describe("exports", () => {
  test("エントリーポイントは実行時の公開値をすべて再エクスポートする", ({ expect }) => {
    // 実行と検証：
    expect(Object.keys(core).sort()).toStrictEqual([
      "DbErrorBase",
      "DbNotOpenError",
      "DbQueryError",
      "EmbErrorBase",
      "EmbedFailedError",
      "EmbeddingModelMismatchError",
      "ErrorBase",
      "InvalidUsageErrorBase",
      "ModelLoadError",
      "UnexpectedErrorBase",
      "UnsupportedModalityError",
      "VectorDimensionMismatchError",
      "setErrorMessage",
    ]);
  });

  test("エントリーポイントの実行時の値は各モジュールと同一である", ({ expect }) => {
    // 実行と検証：
    expect(core.ErrorBase).toBe(errors.ErrorBase);
    expect(core.InvalidUsageErrorBase).toBe(errors.InvalidUsageErrorBase);
    expect(core.UnexpectedErrorBase).toBe(errors.UnexpectedErrorBase);
    expect(core.setErrorMessage).toBe(errors.setErrorMessage);
    expect(core.DbErrorBase).toBe(dbErrors.DbErrorBase);
    expect(core.DbNotOpenError).toBe(dbErrors.DbNotOpenError);
    expect(core.DbQueryError).toBe(dbErrors.DbQueryError);
    expect(core.VectorDimensionMismatchError).toBe(dbErrors.VectorDimensionMismatchError);
    expect(core.EmbeddingModelMismatchError).toBe(dbErrors.EmbeddingModelMismatchError);
    expect(core.EmbErrorBase).toBe(embErrors.EmbErrorBase);
    expect(core.UnsupportedModalityError).toBe(embErrors.UnsupportedModalityError);
    expect(core.EmbedFailedError).toBe(embErrors.EmbedFailedError);
    expect(core.ModelLoadError).toBe(embErrors.ModelLoadError);
  });

  test("型のみのモジュールは実行時の値を公開しない", ({ expect }) => {
    // 実行と検証：
    expect(Object.keys(contextTypes)).toStrictEqual([]);
    expect(Object.keys(dbTypes)).toStrictEqual([]);
    expect(Object.keys(embTypes)).toStrictEqual([]);
    expect(Object.keys(objectTypes)).toStrictEqual([]);
  });

  test("context の型はエントリーポイントから同一に解決される", () => {
    // 実行と検証：
    expectTypeOf<contextTypes.ContextAction>().toEqualTypeOf<core.ContextAction>();
    expectTypeOf<contextTypes.IActionContext>().toEqualTypeOf<core.IActionContext>();
    expectTypeOf<contextTypes.ILifecycleContext>().toEqualTypeOf<core.ILifecycleContext>();
    expectTypeOf<contextTypes.IOpenContext>().toEqualTypeOf<core.IOpenContext>();
    expectTypeOf<contextTypes.ICloseContext>().toEqualTypeOf<core.ICloseContext>();
  });

  test("db の型はエントリーポイントから同一に解決される", () => {
    // 実行と検証：
    expectTypeOf<dbTypes.IObjectIndex>().toEqualTypeOf<core.IObjectIndex>();
    expectTypeOf<dbTypes.IUpsertContext>().toEqualTypeOf<core.IUpsertContext>();
    expectTypeOf<dbTypes.IGetContext>().toEqualTypeOf<core.IGetContext>();
    expectTypeOf<dbTypes.IDeleteContext>().toEqualTypeOf<core.IDeleteContext>();
    expectTypeOf<dbTypes.IListContext>().toEqualTypeOf<core.IListContext>();
    expectTypeOf<dbTypes.ISearchContext>().toEqualTypeOf<core.ISearchContext>();
    expectTypeOf<dbTypes.IndexedObject>().toEqualTypeOf<core.IndexedObject>();
    expectTypeOf<dbTypes.VectorMetric>().toEqualTypeOf<core.VectorMetric>();
  });

  test("emb の型はエントリーポイントから同一に解決される", () => {
    // 実行と検証：
    expectTypeOf<embTypes.IEmbedder>().toEqualTypeOf<core.IEmbedder>();
    expectTypeOf<embTypes.IEmbedContext>().toEqualTypeOf<core.IEmbedContext>();
    expectTypeOf<embTypes.IEmbedManyContext>().toEqualTypeOf<core.IEmbedManyContext>();
    expectTypeOf<embTypes.IEmbedTextContext>().toEqualTypeOf<core.IEmbedTextContext>();
    expectTypeOf<embTypes.ISupportsContext>().toEqualTypeOf<core.ISupportsContext>();
    expectTypeOf<embTypes.EmbedderInfo>().toEqualTypeOf<core.EmbedderInfo>();
    expectTypeOf<embTypes.EmbedInput>().toEqualTypeOf<core.EmbedInput>();
    expectTypeOf<embTypes.EmbedModality>().toEqualTypeOf<core.EmbedModality>();
  });

  test("object の型はエントリーポイントから同一に解決される", () => {
    // 実行と検証：
    expectTypeOf<objectTypes.OmnioKey>().toEqualTypeOf<core.OmnioKey>();
    expectTypeOf<objectTypes.OmnioObject>().toEqualTypeOf<core.OmnioObject>();
    expectTypeOf<objectTypes.OmnioSystemMetadata>().toEqualTypeOf<core.OmnioSystemMetadata>();
    expectTypeOf<objectTypes.EmbedSource>().toEqualTypeOf<core.EmbedSource>();
    expectTypeOf<objectTypes.MetadataFilter>().toEqualTypeOf<core.MetadataFilter>();
  });

  test("errors の型はエントリーポイントから同一に解決される", () => {
    // 実行と検証：
    expectTypeOf<core.ErrorMeta>().toEqualTypeOf<errors.ErrorMeta>();
    expectTypeOf<core.ErrorOptions>().toEqualTypeOf<errors.ErrorOptions>();
    expectTypeOf<core.DbNotOpenErrorArgs>().toEqualTypeOf<dbErrors.DbNotOpenErrorArgs>();
    expectTypeOf<core.DbNotOpenErrorMeta>().toEqualTypeOf<dbErrors.DbNotOpenErrorMeta>();
    expectTypeOf<core.UnsupportedModalityErrorArgs>().toEqualTypeOf<embErrors.UnsupportedModalityErrorArgs>();
    expectTypeOf<core.UnsupportedModalityErrorMeta>().toEqualTypeOf<embErrors.UnsupportedModalityErrorMeta>();
  });
});
