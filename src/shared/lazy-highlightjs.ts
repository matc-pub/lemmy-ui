import { HLJSApi, HLJSPlugin, LanguageFn } from "highlight.js";
import hljs from "highlight.js/lib/core";
import { bundledSyntaxHighlighters } from "./build-config";
import { isBrowser } from "@utils/browser";
import { default as MarkdownIt } from "markdown-it";

class LazyHighlightjs implements HLJSPlugin {
  public hljs: HLJSApi;

  private loadedLanguages: Set<string> = new Set();
  private failedLanguages: Set<string> = new Set();

  constructor(hljs: HLJSApi) {
    this.hljs = hljs;
    this.hljs.addPlugin(this);

    // For consistent autodetection behaviour.
    this.hljs.configure({ languages: bundledSyntaxHighlighters });

    for (const lang of bundledSyntaxHighlighters) {
      //"eager" means bundled, imports are resolved pseudo synchronously
      import(
        /* webpackMode: "eager" */
        `highlight.js/lib/languages/${lang}.js`
      )
        .then(x => {
          hljs.registerLanguage(lang, x.default);
          this.loadedLanguages.add(lang);
        })
        .catch(err => {
          console.error(`Syntax highlighter "${lang}" failed:`, err);
          this.failedLanguages.add(lang);
        });
    }
  }

  private loadLanguage(lang: string): Promise<LanguageFn> {
    const promise = import(
      /* webpackChunkName: "hljs-[request]" */
      `highlight.js/lib/languages/${lang}.js`
    ).then(x => x.default);
    promise
      .then(x => {
        this.hljs.registerLanguage(lang, x);
        this.loadedLanguages.add(lang);
      })
      .catch(() => {
        this.failedLanguages.add(lang);
      });
    return promise;
  }

  private enabled: boolean = false;
  private current?: {
    readonly callback: () => void;
    readonly pending: Set<string>;
  };

  "before:highlight"(context: { language: string }) {
    const { language: lang } = context;
    if (this.loadedLanguages.has(lang)) return;
    context.language = "plaintext"; // Silences "Could not find language"
    if (!this.enabled || this.failedLanguages.has(lang)) {
      return;
    }
    if (!this.current) {
      console.warn(`Lazy highlightjs "${lang}" without callback.`);
      this.loadLanguage(lang);
      return;
    }
    const { callback, pending } = this.current;
    pending.add(lang);
    this.loadLanguage(lang)
      .catch(() => {})
      .finally(() => {
        if (pending.delete(lang) && !pending.size) {
          // last remaining language removed, can call callback
          requestAnimationFrame(() => {
            callback();
          });
        }
      });
  }

  public render(
    md: MarkdownIt,
    text: string,
    shouldRerender: () => void,
  ): string {
    if (this.current) throw "no nesting";
    if (shouldRerender) {
      this.current = { callback: shouldRerender, pending: new Set() };
    }
    const result = md.render(text);
    this.current = undefined;
    return result;
  }

  public enableLazyLoading() {
    // When the server renders in a lazy language, the client will replace it
    // with a plaintext render until the language is loaded.
    console.assert(isBrowser(), "No lazy loading on server.");
    this.enabled = true;
  }

  public disableLazyLoading() {
    this.enabled = false;
  }
}

export const lazyHighlightjs = new LazyHighlightjs(hljs);
