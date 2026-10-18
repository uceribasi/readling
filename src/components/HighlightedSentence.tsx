/** Renders a sentence with the first occurrence of `surface` highlighted. */
export function HighlightedSentence({ sentence, surface }: { sentence: string; surface: string }) {
  const index = sentence.indexOf(surface)
  if (index === -1) return <>{sentence}</>
  return (
    <>
      {sentence.slice(0, index)}
      <mark className="rounded bg-indigo-100 px-0.5 text-inherit dark:bg-indigo-500/30">{surface}</mark>
      {sentence.slice(index + surface.length)}
    </>
  )
}
