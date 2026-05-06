export function jsonError(message: string, status: number) {
  return Response.json(
    {
      error: message
    },
    {
      status
    }
  );
}

export function readOptionalString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function isUploadFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value &&
    Number((value as File).size) > 0
  );
}
