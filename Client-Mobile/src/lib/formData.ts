export type LocalFormDataFile = {
  uri: string;
  name: string;
  type: string;
};

type ReactNativeFormDataFile = {
  uri: string;
  name: string;
  type: string;
};

type ReactNativeFormData = {
  append(name: string, value: string | ReactNativeFormDataFile): void;
};

export function appendFormDataFile(
  formData: FormData,
  fieldName: string,
  file: LocalFormDataFile,
): void {
  (formData as unknown as ReactNativeFormData).append(fieldName, {
    uri: file.uri,
    name: file.name,
    type: file.type,
  });
}
