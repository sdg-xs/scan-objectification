import { createRoot } from "react-dom/client";
import { AssetLibraryPicker } from "./asset-library-picker";
import type { AssetLibraryPickerProps } from "./asset-library-picker";

export function mountAssetLibraryPicker(host: HTMLElement) {
  const root = createRoot(host);
  return {
    render: (props: AssetLibraryPickerProps, session: number) => root.render(<AssetLibraryPicker key={session} {...props} />),
    dispose: () => root.unmount(),
  };
}
