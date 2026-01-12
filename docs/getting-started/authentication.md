# Authentication Setup Guide

This guide explains the new authentication and user management features added to VipSim.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

New packages added:
- `bcrypt` - Password hashing
- `jsonwebtoken` - JWT token generation
- `dotenv` - Environment variable management

### 2. Configure Environment Variables

Create a `.env` file in the `server/` directory:

```bash
cd server
cp .env.example .env
```

**IMPORTANT:** Edit `server/.env` and change the `JWT_SECRET` to a strong random string:

```env
JWT_SECRET=your-very-secure-random-secret-key-here
JWT_EXPIRY=24h
PORT=3000
```

### 3. Start the Application

```bash
npm run dev
```

This will start both the backend server and frontend development server.

## First User Setup

1. Open the application in your browser
2. You'll see the login page
3. Click "Create Account"
4. Register with your credentials
5. **The first user to register automatically becomes an admin**

## User Roles

### Admin
- Create, edit, and delete clinical cases
- View all user sessions
- Manage users (promote/demote, delete)
- Access full analytics dashboard

### Regular User
- Practice with available cases
- View their own session history
- Track personal progress

## Features

### Authentication System
- JWT-based token authentication
- Secure password hashing with bcrypt
- Token expiration (24 hours by default)
- Automatic token verification on app load

### Database Changes
New tables:
- `users` - User accounts with roles
- Enhanced `sessions` - Now linked to users with duration tracking
- `interactions` - Already existed, now tied to authenticated users

### Frontend Components
- **Login Page** - User authentication
- **Register Page** - New user registration
- **Session History** - View past practice sessions
- **User Management** - Admin-only user administration

### Backend API Endpoints

#### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login (returns JWT token)
- `GET /api/auth/verify` - Verify token validity
- `GET /api/auth/profile` - Get current user profile

#### User Management (Admin Only)
- `GET /api/users` - List all users
- `GET /api/users/:id` - Get user details
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

#### Analytics
- `GET /api/analytics/sessions` - Get sessions (filtered by role)
- `GET /api/analytics/sessions/:id` - Get session details with chat log
- `GET /api/analytics/user-stats/:userId` - Get user statistics

#### Protected Routes
All existing routes now require authentication:
- `/api/cases` (GET: authenticated, POST/PUT/DELETE: admin only)
- `/api/sessions` (authenticated)
- `/api/interactions` (authenticated)

## Security Features

1. **Password Security**: Bcrypt hashing with salt rounds = 10
2. **JWT Tokens**: Signed with secret key, 24-hour expiration
3. **Role-Based Access**: Middleware enforces admin/user permissions
4. **Session Ownership**: Users can only access their own sessions (admins see all)
5. **Input Validation**: Server-side validation on all inputs

## Troubleshooting

### "Invalid token" or "Access denied" errors
- Token may have expired (24 hours)
- Log out and log back in
- Check that server/.env exists with JWT_SECRET

### Cannot create cases
- Only admins can create/edit/delete cases
- Ensure your user has admin role

### First user not becoming admin
- Delete `server/database.sqlite` and restart
- First registration will create admin user

## Architecture Notes

See [Architecture Guide](../reference/architecture.md) for full system architecture details.

Key changes:
- All API requests now include `Authorization: Bearer <token>` header
- Frontend stores JWT in localStorage
- AuthContext manages global authentication state
- Protected routes automatically redirect to login

## Development Notes

### Adding New Protected Routes

Backend:
```javascript
import { authenticateToken, requireAdmin } from './middleware/auth.js';

// Requires authentication
router.get('/api/protected', authenticateToken, (req, res) => {
    // req.user contains authenticated user data
});

// Requires admin role
router.post('/api/admin-only', authenticateToken, requireAdmin, (req, res) => {
    // Only admins can access
});
```

Frontend:
```javascript
import { AuthService } from '../services/authService';

const token = AuthService.getToken();
fetch('/api/endpoint', {
    headers: {
        'Authorization': `Bearer ${token}`
    }
});
```

### Using Auth Context

```javascript
import { useAuth } from '../contexts/AuthContext';

function MyComponent() {
    const { user, isAdmin, logout } = useAuth();
    
    if (!user) return <div>Not logged in</div>;
    
    return (
        <div>
            Welcome {user.username}
            {isAdmin() && <AdminControls />}
        </div>
    );
}
```
