// i18n bootstrap. Resources are bundled (small dictionaries, ~80 keys × 11 langs).
// Language is set explicitly by useShopContextBootstrap() — we never autodetect
// from the browser inside an iframe because the Shopify theme is the source of
// truth.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import sv from "./locales/sv.json";
import en from "./locales/en.json";
import de from "./locales/de.json";
import no from "./locales/no.json";
import da from "./locales/da.json";
import fi from "./locales/fi.json";
import fr from "./locales/fr.json";
import es from "./locales/es.json";
import it from "./locales/it.json";
import nl from "./locales/nl.json";
import pl from "./locales/pl.json";

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      sv: { translation: sv },
      en: { translation: en },
      de: { translation: de },
      no: { translation: no },
      da: { translation: da },
      fi: { translation: fi },
      fr: { translation: fr },
      es: { translation: es },
      it: { translation: it },
      nl: { translation: nl },
      pl: { translation: pl },
    },
    lng: "sv",
    fallbackLng: "sv",
    interpolation: { escapeValue: false },
    returnNull: false,
  });

export default i18n;
