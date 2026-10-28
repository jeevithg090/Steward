import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PhoneApp } from "./App.tsx";
import "../styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("Steward's page is missing its #root element.");

createRoot(root).render(
  <StrictMode>
    <PhoneApp />
  </StrictMode>,
);
