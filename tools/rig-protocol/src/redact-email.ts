const EMAIL_TOKEN = /[A-Za-z0-9._%+@-]+/g;
const EMAIL_DOMAIN = /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function redactEmailAddresses(text: string): string {
  return text.replaceAll(EMAIL_TOKEN, (token) => {
    if (!token.includes("@")) return token;

    // Splitting at each @ lets the domain check read every segment once.
    const [first = "", ...segments] = token.split("@");
    const output: string[] = [];
    let local = first;
    for (const segment of segments) {
      const domain = local ? EMAIL_DOMAIN.exec(segment)?.[0] : undefined;
      if (domain) {
        output.push("[email redacted]");
        local = segment.slice(domain.length);
      } else {
        output.push(local, "@");
        local = segment;
      }
    }
    return output.join("") + local;
  });
}
