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
  InvalidUsageErrorBase,
  UnsupportedModalityError,
  EmbeddingModelMismatchError,
  VectorDimensionMismatchError,
} from "./errors/index.js";

export type * from "./context.types.js";

export type * from "./idx.types.js";

export type * from "./emb.types.js";

export type * from "./object.types.js";
