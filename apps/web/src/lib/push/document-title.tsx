"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useT } from "@/i18n/provider";

interface DocumentTitleContextValue {
  title: string | undefined;
  register: (name: string) => () => void;
}

const DocumentTitleContext = createContext<DocumentTitleContextValue | null>(null);

export function DocumentTitleProvider({
  baseName,
  children,
}: {
  baseName?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const [page, setPage] = useState<{ name: string } | null>(null);
  const register = useCallback((name: string) => {
    const entry = { name };
    setPage(entry);
    return () => setPage((current) => current === entry ? null : current);
  }, []);
  const name = page?.name ?? baseName;
  const title = name ? t("shell.documentTitle", { name }) : undefined;
  const value = useMemo(() => ({ register, title }), [register, title]);
  return (
    <DocumentTitleContext.Provider value={value}>
      {children}
    </DocumentTitleContext.Provider>
  );
}

export function useDocumentTitle(name: string | null) {
  const register = useContext(DocumentTitleContext)?.register;
  useEffect(() => {
    if (name && register) return register(name);
  }, [name, register]);
}

export function useDocumentTitleOverride(): string | undefined {
  return useContext(DocumentTitleContext)?.title;
}
