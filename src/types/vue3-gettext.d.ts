declare module 'vue3-gettext' {
  export interface GettextContext {
    $gettext: (msgid: string) => string
    $ngettext: (msgid: string, plural: string, n: number) => string
    $pgettext: (context: string, msgid: string) => string
    $npgettext: (context: string, msgid: string, plural: string, n: number) => string
    current: string
  }

  export function useGettext(): GettextContext
}
