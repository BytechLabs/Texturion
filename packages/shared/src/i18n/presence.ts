export const presenceCopy = {
  en: {
    unnamed: "A teammate",
    viewingOne: (name: string) => `${name} is also here`,
    viewingTwo: (first: string, second: string) => `${first} and ${second} are also here`,
    viewingMany: (count: number) => `${count} teammates are also here`,
    replyingOne: (name: string) => `${name} is replying…`,
    replyingTwo: (first: string, second: string) => `${first} and ${second} are replying…`,
    replyingMany: (count: number) => `${count} people are replying…`,
  },
  "fr-CA": {
    unnamed: "Un membre de l’équipe",
    viewingOne: (name: string) => `${name} est aussi là`,
    viewingTwo: (first: string, second: string) => `${first} et ${second} sont aussi là`,
    viewingMany: (count: number) => `${count} membres de l’équipe sont aussi là`,
    replyingOne: (name: string) => `${name} rédige une réponse…`,
    replyingTwo: (first: string, second: string) => `${first} et ${second} rédigent une réponse…`,
    replyingMany: (count: number) => `${count} personnes rédigent une réponse…`,
  },
};
