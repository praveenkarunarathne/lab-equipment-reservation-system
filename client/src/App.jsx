import { BrowserRouter } from 'react-router';
import { AuthProvider } from './auth/AuthContext.jsx';
import AppRoutes from './routes/AppRoutes.jsx';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <main>
          <p className="brand">Lab Equipment Reservation System</p>
          <AppRoutes />
        </main>
      </BrowserRouter>
    </AuthProvider>
  );
}
