import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DemoProvider } from "./context/DemoContext";
import { Layout } from "./components/Layout";
import { IntakePage } from "./pages/IntakePage";
import { QuotePage } from "./pages/QuotePage";
import { ProcurementPage } from "./pages/ProcurementPage";

export default function App() {
  return (
    <DemoProvider>
      <BrowserRouter basename="/seabay-ai-logistics-demo">
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/intake" replace />} />
            <Route path="/intake" element={<IntakePage />} />
            <Route path="/quote" element={<QuotePage />} />
            <Route path="/procurement" element={<ProcurementPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </DemoProvider>
  );
}
