import { z } from "zod";

export const HttpVerbSchema = z.enum(["GET", "PUT", "POST", "PATCH", "DELETE"]);
export type HttpVerb = z.infer<typeof HttpVerbSchema>;

export const AccessModeSchema = z.enum([
  "READ_ACCESS",
  "WRITE_ACCESS",
  "WRITE_TRANSACTION_ACCESS"
]);
export type AccessMode = z.infer<typeof AccessModeSchema>;

export const ObjectCallRequestSchema = z
  .object({
    objectPath: z.string().min(1),
    functionName: z.string().min(1),
    parameters: z.record(z.string(), z.unknown()).optional(),
    generateTransaction: z.boolean().optional()
  })
  .strict();
export type ObjectCallRequest = z.infer<typeof ObjectCallRequestSchema>;

export const ObjectCallResponseSchema = z
  .object({
    ReturnValue: z.unknown().optional()
  })
  .passthrough();
export type ObjectCallResponse = z.infer<typeof ObjectCallResponseSchema>;

export const ObjectPropertyRequestSchema = z
  .object({
    objectPath: z.string().min(1),
    propertyName: z.string().min(1).optional(),
    propertyValue: z.unknown().optional(),
    access: AccessModeSchema.optional()
  })
  .strict();
export type ObjectPropertyRequest = z.infer<typeof ObjectPropertyRequestSchema>;

export const ObjectPropertyResponseSchema = z
  .object({
    ReturnValue: z.unknown().optional()
  })
  .passthrough();
export type ObjectPropertyResponse = z.infer<typeof ObjectPropertyResponseSchema>;

export const ObjectDescribeRequestSchema = z
  .object({
    objectPath: z.string().min(1)
  })
  .strict();
export type ObjectDescribeRequest = z.infer<typeof ObjectDescribeRequestSchema>;

export const PropertyMetadataSchema = z
  .object({
    Name: z.string(),
    Description: z.string().optional(),
    Type: z.string().optional(),
    Metadata: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();
export type PropertyMetadata = z.infer<typeof PropertyMetadataSchema>;

export const FunctionArgumentSchema = z
  .object({
    Name: z.string(),
    Type: z.string().optional(),
    Description: z.string().optional(),
    Metadata: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();
export type FunctionArgument = z.infer<typeof FunctionArgumentSchema>;

export const FunctionMetadataSchema = z
  .object({
    Name: z.string(),
    Description: z.string().optional(),
    ReturnType: z.string().optional(),
    Arguments: z.array(FunctionArgumentSchema).optional(),
    Metadata: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();
export type FunctionMetadata = z.infer<typeof FunctionMetadataSchema>;

export const ObjectDescribeResponseSchema = z
  .object({
    Name: z.string().optional(),
    Class: z.string().optional(),
    DisplayName: z.string().optional(),
    Path: z.string().optional(),
    Properties: z.array(PropertyMetadataSchema).optional(),
    Functions: z.array(FunctionMetadataSchema).optional()
  })
  .passthrough();
export type ObjectDescribeResponse = z.infer<typeof ObjectDescribeResponseSchema>;

export const SearchAssetsRequestSchema = z
  .object({
    query: z.string().optional(),
    classNames: z.array(z.string()).optional(),
    packagePaths: z.array(z.string()).optional(),
    recursivePaths: z.boolean().optional(),
    recursiveClasses: z.boolean().optional(),
    includeOnlyOnDiskAssets: z.boolean().optional()
  })
  .passthrough();
export type SearchAssetsRequest = z.infer<typeof SearchAssetsRequestSchema>;

export const AssetInfoSchema = z
  .object({
    Name: z.string().optional(),
    ObjectPath: z.string().optional(),
    PackageName: z.string().optional(),
    PackagePath: z.string().optional(),
    AssetClass: z.string().optional(),
    Class: z.string().optional()
  })
  .passthrough();
export type AssetInfo = z.infer<typeof AssetInfoSchema>;

export const SearchAssetsResponseSchema = z
  .object({
    Assets: z.array(AssetInfoSchema).optional(),
    Results: z.array(AssetInfoSchema).optional()
  })
  .passthrough();
export type SearchAssetsResponse = z.infer<typeof SearchAssetsResponseSchema>;

export const BatchRequestItemSchema = z
  .object({
    RequestId: z.number().int().nonnegative(),
    URL: z.string().min(1),
    Verb: HttpVerbSchema,
    Body: z.unknown().optional()
  })
  .strict();
export type BatchRequestItem = z.infer<typeof BatchRequestItemSchema>;

export const BatchRequestSchema = z
  .object({
    Requests: z.array(BatchRequestItemSchema)
  })
  .strict();
export type BatchRequest = z.infer<typeof BatchRequestSchema>;

export const BatchResponseItemSchema = z
  .object({
    RequestId: z.number().int().nonnegative(),
    ResponseCode: z.number().int(),
    ResponseBody: z.unknown().optional()
  })
  .passthrough();
export type BatchResponseItem = z.infer<typeof BatchResponseItemSchema>;

export const BatchResponseSchema = z
  .object({
    Responses: z.array(BatchResponseItemSchema).optional()
  })
  .passthrough();
export type BatchResponse = z.infer<typeof BatchResponseSchema>;

export const RouteInfoSchema = z
  .object({
    Path: z.string().optional(),
    Verb: z.string().optional(),
    Description: z.string().optional()
  })
  .passthrough();
export type RouteInfo = z.infer<typeof RouteInfoSchema>;

export const InfoResponseSchema = z
  .object({
    HttpRoutes: z.array(RouteInfoSchema).optional(),
    Routes: z.array(RouteInfoSchema).optional()
  })
  .passthrough();
export type InfoResponse = z.infer<typeof InfoResponseSchema>;

export const ObjectEventRequestSchema = z
  .object({
    objectPath: z.string().min(1),
    propertyName: z.string().min(1).optional(),
    timeoutSeconds: z.number().positive().optional()
  })
  .passthrough();
export type ObjectEventRequest = z.infer<typeof ObjectEventRequestSchema>;

export const ObjectEventResponseSchema = z
  .object({
    objectPath: z.string().optional(),
    propertyName: z.string().optional(),
    propertyValue: z.unknown().optional()
  })
  .passthrough();
export type ObjectEventResponse = z.infer<typeof ObjectEventResponseSchema>;

export const ObjectThumbnailRequestSchema = z
  .object({
    objectPath: z.string().min(1)
  })
  .passthrough();
export type ObjectThumbnailRequest = z.infer<typeof ObjectThumbnailRequestSchema>;

export const ObjectThumbnailResponseSchema = z.unknown();
export type ObjectThumbnailResponse = z.infer<typeof ObjectThumbnailResponseSchema>;
