"use client";
import { useParams } from "next/navigation";
export default function ErrorPage({ reset }: { reset: () => void }) {
  const en = useParams()?.lang === "en";
  return (
    <main className="error-page">
      <span className="footer-brand">
        AFTERLIGHT<span>.</span>
      </span>
      <h1>
        {en
          ? "The stories could not be loaded"
          : "Не удалось загрузить материалы"}
      </h1>
      <p>
        {en
          ? "Please try again in a moment."
          : "Попробуйте ещё раз через некоторое время."}
      </p>
      <button className="read-button" onClick={reset}>
        {en ? "Try again" : "Повторить"}
      </button>
    </main>
  );
}
