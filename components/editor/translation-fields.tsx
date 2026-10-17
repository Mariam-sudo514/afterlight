/* eslint-disable @next/next/no-img-element -- Draft covers must be read from the authenticated media route without an optimizer cache. */
import type { RefObject } from "react";
import type { Locale, PostInput } from "@/lib/content";
import { RichText } from "@/components/rich-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { labels } from "./labels";
import { ArrowIcon } from "@/components/ui/arrow-icon";

type Props = {
  post: PostInput;
  locale: Locale;
  lang: Locale;
  setLang: (locale: Locale) => void;
  mode: string;
  setMode: (mode: string) => void;
  bodyRef: RefObject<HTMLTextAreaElement | null>;
  translation: (
    key: "title" | "excerpt" | "body" | "coverCaption",
    value: string,
  ) => void;
  format: (kind: "bold" | "heading" | "link") => void;
};
export function TranslationFields({
  post,
  locale,
  lang,
  setLang,
  mode,
  setMode,
  bodyRef,
  translation,
  format,
}: Props) {
  const t = labels[locale];
  return (
    <section className="editor-writing">
      <Tabs value={lang} onValueChange={(value) => setLang(value as Locale)}>
        <TabsList className="editor-tabs">
          <TabsTrigger value="ru">RU · Русский</TabsTrigger>
          <TabsTrigger value="en">EN · English</TabsTrigger>
        </TabsList>
        {(["ru", "en"] as const).map((current) => (
          <TabsContent value={current} key={current}>
            <div className="translation-form">
              <label className="field">
                <span>{t.title}</span>
                <Input
                  className="editor-input title-input"
                  value={post[current].title}
                  maxLength={160}
                  onChange={(e) => translation("title", e.target.value)}
                />
              </label>
              <label className="field">
                <span>{t.excerpt}</span>
                <Textarea
                  className="editor-input"
                  rows={3}
                  value={post[current].excerpt}
                  maxLength={500}
                  onChange={(e) => translation("excerpt", e.target.value)}
                />
                <small>{t.excerptHelp}</small>
              </label>
              <label className="field">
                <span>{t.caption}</span>
                <Input
                  className="editor-input"
                  value={post[current].coverCaption}
                  maxLength={300}
                  onChange={(e) => translation("coverCaption", e.target.value)}
                />
              </label>
              <Tabs value={mode} onValueChange={setMode}>
                <div className="writing-mode">
                  <span>{t.body}</span>
                  <TabsList className="editor-tabs compact">
                    <TabsTrigger value="write">{t.write}</TabsTrigger>
                    <TabsTrigger value="preview">{t.preview}</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="write">
                  <div className="format-toolbar">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => format("bold")}
                    >
                      <strong>B</strong> {t.bold}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => format("heading")}
                    >
                      H2 {t.headingTool}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => format("link")}
                    >
                      <ArrowIcon />
                      {t.link}
                    </Button>
                  </div>
                  <Textarea
                    ref={bodyRef}
                    className="editor-input body-input"
                    aria-label={t.body}
                    rows={24}
                    value={post[current].body}
                    maxLength={180000}
                    onChange={(e) => translation("body", e.target.value)}
                  />
                  <p className="format-help">{t.bodyHelp}</p>
                </TabsContent>
                <TabsContent value="preview">
                  <div className="editor-reading-preview" lang={current}>
                    <h2>{post[current].title || t.untitled}</h2>
                    <p className="article-deck">{post[current].excerpt}</p>
                    {post.cover && (
                      <figure>
                        <img
                          src={post.cover}
                          alt={post[current].coverCaption}
                          width={800}
                          height={500}
                        />
                        <figcaption>{post[current].coverCaption}</figcaption>
                      </figure>
                    )}
                    {post[current].body ? (
                      <RichText body={post[current].body} />
                    ) : (
                      <p>{t.previewEmpty}</p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
