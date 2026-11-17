import { createContext, useContext } from "react";

type ConfirmLeaving = (label: string, proceed: () => void) => void;

export const ConfirmLeavingContext = createContext<ConfirmLeaving>((_label, proceed) => proceed());

export function useConfirmLeaving(): ConfirmLeaving {
  return useContext(ConfirmLeavingContext);
}
