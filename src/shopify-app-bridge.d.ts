// App Bridge web components usable in JSX. App Bridge (loaded via the CDN script
// in index.html) upgrades <ui-nav-menu> and renders its links as the app's
// navigation (sub-tabs) in the Shopify admin.
import type React from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "ui-nav-menu": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
