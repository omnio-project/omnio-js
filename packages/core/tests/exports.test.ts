// oxlint-disable import/no-namespace
import { test, describe, expectTypeOf } from "vite-plus/test";

import * as contextTypes from "../src/context.types.js";
import * as embTypes from "../src/emb.types.js";
import * as dbErrors from "../src/errors/db-errors.js";
import * as embErrors from "../src/errors/emb-errors.js";
import * as errors from "../src/errors/errors.js";
import * as dbTypes from "../src/idx.types.js";
import * as core from "../src/index.js";
import * as objectKey from "../src/object-key.js";
import * as objectTypes from "../src/object.types.js";
import * as schemas from "../src/schemas.js";

describe("exports", () => {
  test("エントリーポイントは実行時の公開値をすべて再エクスポートする", ({ expect }) => {
    // 実行と検証：
    expect(Object.keys(core).sort()).toStrictEqual([
      "ContentTypeSchema",
      "DbErrorBase",
      "DbNotOpenError",
      "DbQueryError",
      "DescriptionSchema",
      "EmbErrorBase",
      "EmbedFailedError",
      "EmbeddingDimsSchema",
      "EmbeddingModelMismatchError",
      "EmbeddingModelSchema",
      "EntityMissingError",
      "ErrorBase",
      "HashSchema",
      "InvalidOmnioKeyError",
      "InvalidUsageErrorBase",
      "MAX_OBJECT_KEY_BYTES",
      "MAX_OBJECT_KEY_LENGTH",
      "MAX_OBJECT_SIZE",
      "MAX_TAGS",
      "MAX_TAG_BYTES",
      "MAX_TAG_LENGTH",
      "ModelLoadError",
      "ObjectKeySchema",
      "OmnioKey",
      "OperationAbortedError",
      "SHA256_HEX_REGEX",
      "SizeSchema",
      "TagSchema",
      "TagsSchema",
      "TimestampSchema",
      "UnexpectedErrorBase",
      "UnsupportedModalityError",
      "UserMetadataSchema",
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
    expect(core.EntityMissingError).toBe(errors.EntityMissingError);
    expect(core.InvalidOmnioKeyError).toBe(errors.InvalidOmnioKeyError);
    expect(core.OperationAbortedError).toBe(errors.OperationAbortedError);
    expect(core.ObjectKeySchema).toBe(schemas.ObjectKeySchema);
    expect(core.TagSchema).toBe(schemas.TagSchema);
    expect(core.TagsSchema).toBe(schemas.TagsSchema);
    expect(core.DescriptionSchema).toBe(schemas.DescriptionSchema);
    expect(core.ContentTypeSchema).toBe(schemas.ContentTypeSchema);
    expect(core.HashSchema).toBe(schemas.HashSchema);
    expect(core.SizeSchema).toBe(schemas.SizeSchema);
    expect(core.TimestampSchema).toBe(schemas.TimestampSchema);
    expect(core.EmbeddingDimsSchema).toBe(schemas.EmbeddingDimsSchema);
    expect(core.EmbeddingModelSchema).toBe(schemas.EmbeddingModelSchema);
    expect(core.UserMetadataSchema).toBe(schemas.UserMetadataSchema);
    expect(core.OmnioKey).toBe(objectKey.OmnioKey);
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
    expectTypeOf<dbTypes.IUpdateMetadataContext>().toEqualTypeOf<core.IUpdateMetadataContext>();
    expectTypeOf<dbTypes.IRenameContext>().toEqualTypeOf<core.IRenameContext>();
    expectTypeOf<dbTypes.IRenameResult>().toEqualTypeOf<core.IRenameResult>();
    expectTypeOf<dbTypes.IGetContext>().toEqualTypeOf<core.IGetContext>();
    expectTypeOf<dbTypes.IHasContext>().toEqualTypeOf<core.IHasContext>();
    expectTypeOf<dbTypes.IDeleteContext>().toEqualTypeOf<core.IDeleteContext>();
    expectTypeOf<dbTypes.IPurgeContext>().toEqualTypeOf<core.IPurgeContext>();
    expectTypeOf<dbTypes.IListContext>().toEqualTypeOf<core.IListContext>();
    expectTypeOf<dbTypes.IListDirtyContext>().toEqualTypeOf<core.IListDirtyContext>();
    expectTypeOf<dbTypes.IMarkDirtyContext>().toEqualTypeOf<core.IMarkDirtyContext>();
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

  test("object-key の型はエントリーポイントから同一に解決される", () => {
    // 実行と検証：
    expectTypeOf<objectKey.OmnioKey>().toEqualTypeOf<core.OmnioKey>();
  });

  test("object の型はエントリーポイントから同一に解決される", () => {
    // 実行と検証：
    expectTypeOf<objectTypes.OmnioObject>().toEqualTypeOf<core.OmnioObject>();
    expectTypeOf<objectTypes.OmnioSystemMetadata>().toEqualTypeOf<core.OmnioSystemMetadata>();
    expectTypeOf<objectTypes.ObjectMetadataPatch>().toEqualTypeOf<core.ObjectMetadataPatch>();
    expectTypeOf<objectTypes.EmbedSource>().toEqualTypeOf<core.EmbedSource>();
    expectTypeOf<objectTypes.MetadataFilter>().toEqualTypeOf<core.MetadataFilter>();
    expectTypeOf<objectTypes.MetadataFilter.Condition>().toEqualTypeOf<core.MetadataFilter.Condition>();
    expectTypeOf<objectTypes.MetadataFilter.DateCondition>().toEqualTypeOf<core.MetadataFilter.DateCondition>();
    expectTypeOf<objectTypes.MetadataFilter.RecordTypeCondition>().toEqualTypeOf<core.MetadataFilter.RecordTypeCondition>();
    expectTypeOf<objectTypes.MetadataFilter.SizeCondition>().toEqualTypeOf<core.MetadataFilter.SizeCondition>();
    expectTypeOf<objectTypes.MetadataFilter.TagsCondition>().toEqualTypeOf<core.MetadataFilter.TagsCondition>();
  });

  test("schemas の型はエントリーポイントから同一に解決される", () => {
    // 実行と検証：
    expectTypeOf<schemas.ObjectKey>().toEqualTypeOf<core.ObjectKey>();
    expectTypeOf<schemas.ObjectKeyLike>().toEqualTypeOf<core.ObjectKeyLike>();
    expectTypeOf<schemas.Tag>().toEqualTypeOf<core.Tag>();
    expectTypeOf<schemas.TagLike>().toEqualTypeOf<core.TagLike>();
    expectTypeOf<schemas.Tags>().toEqualTypeOf<core.Tags>();
    expectTypeOf<schemas.TagsLike>().toEqualTypeOf<core.TagsLike>();
    expectTypeOf<schemas.Description>().toEqualTypeOf<core.Description>();
    expectTypeOf<schemas.ContentType>().toEqualTypeOf<core.ContentType>();
    expectTypeOf<schemas.Hash>().toEqualTypeOf<core.Hash>();
    expectTypeOf<schemas.Size>().toEqualTypeOf<core.Size>();
    expectTypeOf<schemas.Timestamp>().toEqualTypeOf<core.Timestamp>();
    expectTypeOf<schemas.EmbeddingDims>().toEqualTypeOf<core.EmbeddingDims>();
    expectTypeOf<schemas.EmbeddingModel>().toEqualTypeOf<core.EmbeddingModel>();
    expectTypeOf<schemas.UserMetadata>().toEqualTypeOf<core.UserMetadata>();
  });

  test("errors の型はエントリーポイントから同一に解決される", () => {
    // 実行と検証：
    expectTypeOf<core.ErrorMeta>().toEqualTypeOf<errors.ErrorMeta>();
    expectTypeOf<core.ErrorOptions>().toEqualTypeOf<errors.ErrorOptions>();
    expectTypeOf<core.DbNotOpenErrorArgs>().toEqualTypeOf<dbErrors.DbNotOpenErrorArgs>();
    expectTypeOf<core.DbNotOpenErrorMeta>().toEqualTypeOf<dbErrors.DbNotOpenErrorMeta>();
    expectTypeOf<core.UnsupportedModalityErrorArgs>().toEqualTypeOf<embErrors.UnsupportedModalityErrorArgs>();
    expectTypeOf<core.UnsupportedModalityErrorMeta>().toEqualTypeOf<embErrors.UnsupportedModalityErrorMeta>();
    expectTypeOf<core.EntityMissingErrorArgs>().toEqualTypeOf<errors.EntityMissingErrorArgs>();
    expectTypeOf<core.EntityMissingErrorMeta>().toEqualTypeOf<errors.EntityMissingErrorMeta>();
    expectTypeOf<core.InvalidOmnioKeyErrorArgs>().toEqualTypeOf<errors.InvalidOmnioKeyErrorArgs>();
    expectTypeOf<core.InvalidOmnioKeyErrorMeta>().toEqualTypeOf<errors.InvalidOmnioKeyErrorMeta>();
  });
});
