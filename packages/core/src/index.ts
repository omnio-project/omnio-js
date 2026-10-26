export type {
  ErrorMeta,
  ErrorOptions,
  DbQueryErrorArgs,
  DbQueryErrorMeta,
  DbNotOpenErrorArgs,
  DbNotOpenErrorMeta,
  ModelLoadErrorArgs,
  ModelLoadErrorMeta,
  EmbedFailedErrorArgs,
  EmbedFailedErrorMeta,
  InvalidOmnioKeyErrorArgs,
  InvalidOmnioKeyErrorMeta,
  UnsupportedModalityErrorArgs,
  UnsupportedModalityErrorMeta,
  EmbeddingModelMismatchErrorArgs,
  EmbeddingModelMismatchErrorMeta,
  VectorDimensionMismatchErrorArgs,
  VectorDimensionMismatchErrorMeta,
} from "./errors/index.js";
export {
  ErrorBase,
  DbErrorBase,
  DbQueryError,
  EmbErrorBase,
  DbNotOpenError,
  ModelLoadError,
  setErrorMessage,
  EmbedFailedError,
  UnexpectedErrorBase,
  InvalidOmnioKeyError,
  InvalidUsageErrorBase,
  UnsupportedModalityError,
  EmbeddingModelMismatchError,
  VectorDimensionMismatchError,
} from "./errors/index.js";

export type * from "./context.types.js";

export type * from "./idx.types.js";

export type * from "./emb.types.js";

export type * from "./object.types.js";

export type {
  Tag,
  Hash,
  Size,
  Tags,
  TagLike,
  HashLike,
  SizeLike,
  TagsLike,
  ObjectKey,
  Timestamp,
  ContentType,
  Description,
  UserMetadata,
  EmbeddingDims,
  ObjectKeyLike,
  TimestampLike,
  EmbeddingModel,
  ContentTypeLike,
  DescriptionLike,
  UserMetadataLike,
  EmbeddingDimsLike,
  EmbeddingModelLike,
} from "./schemas.js";
export {
  MAX_TAGS,
  TagSchema,
  HashSchema,
  SizeSchema,
  TagsSchema,
  MAX_TAG_BYTES,
  MAX_TAG_LENGTH,
  MAX_OBJECT_SIZE,
  ObjectKeySchema,
  TimestampSchema,
  SHA256_HEX_REGEX,
  ContentTypeSchema,
  DescriptionSchema,
  UserMetadataSchema,
  EmbeddingDimsSchema,
  EmbeddingModelSchema,
  MAX_OBJECT_KEY_BYTES,
  MAX_OBJECT_KEY_LENGTH,
} from "./schemas.js";
