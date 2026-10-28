import { BrowserRouter } from 'react-router';
import { AuthProvider } from './auth/AuthContext.jsx';
import AppRoutes from './routes/AppRoutes.jsx';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="app-root">
          <AppRoutes />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
