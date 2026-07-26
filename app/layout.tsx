import type { Metadata } from "next";
import { Averia_Serif_Libre, Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { Toaster } from "sonner";
import { ProviderKeysProvider } from "@/components/billing/provider-keys-provider";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { QualityProvider } from "@/components/quality/quality-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Locale } from "@/lib/i18n/dictionaries";
import { getServerLocale } from "@/lib/i18n/server";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://chat.vercel.ai"),
  title: "ZENO V1",
  description: "ZENO workspace built on top of the AI SDK chatbot template.",
};

export const viewport = {
  maximumScale: 1,
};

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
});

// Display-only serif for the ZENO wordmark and the homepage greeting. Its soft,
// characterful shapes suit a warm "thinking partner" brand but hurt legibility
// in dense UI, so it is never used for body/UI text — only large display.
const averiaSerif = Averia_Serif_Libre({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-averia",
});

const LIGHT_THEME_COLOR = "hsl(0 0% 100%)";
const DARK_THEME_COLOR = "hsl(240deg 10% 3.92%)";
const THEME_COLOR_SCRIPT = `\
(function() {
  var html = document.documentElement;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  function updateThemeColor() {
    var isDark = html.classList.contains('dark');
    meta.setAttribute('content', isDark ? '${DARK_THEME_COLOR}' : '${LIGHT_THEME_COLOR}');
  }
  var observer = new MutationObserver(updateThemeColor);
  observer.observe(html, { attributes: true, attributeFilter: ['class'] });
  updateThemeColor();
})();`;

function Providers({
  locale,
  children,
}: {
  locale?: Locale;
  children: React.ReactNode;
}) {
  return (
    <LocaleProvider initialLocale={locale}>
      <QualityProvider>
        <TooltipProvider>
          <Toaster
            position="top-center"
            theme="system"
            toastOptions={{
              className:
                "!bg-card !text-foreground !border-border/50 !shadow-[var(--shadow-float)]",
            }}
          />
          {/* At the root rather than in the workspace layout, because the two
              trees that need it do not share one: the project home renders
              under this layout directly, the workspace under (chat). It costs
              nothing where it is unused — the dialog is not mounted until
              something opens it. */}
          <ProviderKeysProvider>{children}</ProviderKeysProvider>
        </TooltipProvider>
      </QualityProvider>
    </LocaleProvider>
  );
}

// Reads the locale cookie on the server so the whole tree renders in the user's
// language — keeping SSR and client hydration in sync even for client
// components that hydrate late under streaming. cookies() must sit inside a
// Suspense boundary under cacheComponents (see the fallback below).
async function LocalizedProviders({ children }: { children: React.ReactNode }) {
  const locale = await getServerLocale();
  return <Providers locale={locale}>{children}</Providers>;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${geist.variable} ${geistMono.variable} ${averiaSerif.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: "Required"
          dangerouslySetInnerHTML={{
            __html: THEME_COLOR_SCRIPT,
          }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <Suspense fallback={<Providers>{children}</Providers>}>
            <LocalizedProviders>{children}</LocalizedProviders>
          </Suspense>
        </ThemeProvider>
      </body>
    </html>
  );
}
