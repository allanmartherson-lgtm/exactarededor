import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import '@carbon/styles/css/styles.min.css';

createRoot(document.getElementById("root")!).render(<App />);
