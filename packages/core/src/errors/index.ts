export type {
  DbQueryErrorArgs,
  DbQueryErrorMeta,
  DbNotOpenErrorArgs,
  DbNotOpenErrorMeta,
  EmbeddingModelMismatchErrorArgs,
  EmbeddingModelMismatchErrorMeta,
  VectorDimensionMismatchErrorArgs,
  VectorDimensionMismatchErrorMeta,
} from "./db-errors.js";
export {
  DbErrorBase,
  DbQueryError,
  DbNotOpenError,
  EmbeddingModelMismatchError,
  VectorDimensionMismatchError,
} from "./db-errors.js";

export type {
  ModelLoadErrorArgs,
  ModelLoadErrorMeta,
  EmbedFailedErrorArgs,
  EmbedFailedErrorMeta,
  UnsupportedModalityErrorArgs,
  UnsupportedModalityErrorMeta,
} from "./emb-errors.js";
export {
  EmbErrorBase,
  ModelLoadError,
  EmbedFailedError,
  UnsupportedModalityError,
} from "./emb-errors.js";

export type {
  ErrorMeta,
  ErrorOptions,
  InvalidOmnioKeyErrorArgs,
  InvalidOmnioKeyErrorMeta,
} from "./errors.js";
export {
  ErrorBase,
  setErrorMessage,
  UnexpectedErrorBase,
  InvalidOmnioKeyError,
  InvalidUsageErrorBase,
  OperationAbortedError,
} from "./errors.js";
