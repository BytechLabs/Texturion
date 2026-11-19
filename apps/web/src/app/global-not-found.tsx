import NotFound from "./not-found";
import { RootDocument } from "./root-document";

export { metadata } from "./not-found";
export { viewport } from "./root-document";

export default function GlobalNotFound() {
  return (
    <RootDocument>
      <NotFound />
    </RootDocument>
  );
}
