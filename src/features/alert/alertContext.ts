import { createContext } from "react";
import { Alert } from "./alert";

export const alert = new Alert();

export const AlertContext = createContext({ alert });
