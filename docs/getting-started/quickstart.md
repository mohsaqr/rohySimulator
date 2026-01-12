# 🚀 VipSim Authentication - Quick Start Guide

## Get Running in 3 Minutes ⏱️

### Step 1: Create .env File (30 seconds)

**Choose your platform:**

**macOS/Linux:**
```bash
./SETUP_ENV.sh
```

**Windows:**
```bash
SETUP_ENV.bat
```

**Manual (any platform):**
```bash
cd server
echo "JWT_SECRET=my-super-secret-key-$(date +%s)" > .env
echo "JWT_EXPIRY=24h" >> .env
echo "PORT=3000" >> .env
cd ..
```

---

### Step 2: Start the App (30 seconds)

```bash
npm run dev
```

Wait for:
```
✓ Local:   http://localhost:5173/
✓ Server running on http://localhost:3000
```

---

### Step 3: Create Admin Account (1 minute)

1. **Open:** http://localhost:5173
2. **Click:** "Create Account"
3. **Fill in:**
   - Username: `admin` (or your choice)
   - Email: `admin@example.com`
   - Password: `admin123` (min 6 chars)
   - Confirm Password: `admin123`
4. **Click:** "Create Account"

**🎉 You're now logged in as an admin!**

---

## What You Can Do Now

### As Admin (First User)

#### ✅ Create a Clinical Case
1. Click the ⚙️ **Settings** icon (top right)
2. Go to **Clinical Cases** tab
3. Click **"+ New Case"**
4. Follow the 3-step wizard:
   - **Step 1:** Set persona & behavior
   - **Step 2:** Add case details & demographics
   - **Step 3:** Add clinical records (hidden context)
5. Click **"Save Case"**
6. Click **"Load"** to practice with it

#### ✅ Practice with a Case
1. Load a case from Settings
2. Chat with the AI patient
3. Take history, ask questions
4. Session is automatically logged!

#### ✅ View Session History
1. Click ⚙️ **Settings**
2. Go to **Session History** tab
3. See all your practice sessions
4. Click **"View"** to see full chat log

#### ✅ Manage Users
1. Create a second test user (logout and register again)
2. Login as admin
3. Click ⚙️ **Settings**
4. Go to **User Management** tab
5. See all users
6. Promote/demote or delete users

---

## Test the Role System

### Create a Regular User

1. **Logout:** Click the 🚪 logout icon (top right)
2. **Register:** Click "Create Account"
3. **Login** as the new user

### As Regular User You Can:
- ✅ Load and practice cases
- ✅ View your own session history
- ✅ Configure LLM settings
- ❌ Cannot create/edit/delete cases
- ❌ Cannot manage users

---

## Verify Everything Works

### ✅ Checklist

Run through these to confirm setup:

- [ ] I created server/.env file
- [ ] I started the app with `npm run dev`
- [ ] I created my admin account
- [ ] I can see the main interface
- [ ] I created a test case
- [ ] I practiced with the case
- [ ] I viewed my session history
- [ ] I created a second (regular) user
- [ ] Regular user cannot create cases

---

## Troubleshooting

### "Cannot connect to server"
```bash
# Check if backend is running
curl http://localhost:3000/api/auth/verify
```

### "Module not found" errors
```bash
npm install
```

### Need to reset everything?
```bash
# Delete database and start fresh
rm server/database.sqlite
npm run dev
# First user will be admin again
```

---

## Next Steps

### 📚 Learn More
- [Authentication Guide](authentication.md) - User management & security
- [Architecture Guide](../reference/architecture.md) - System architecture
- [System Documentation](../reference/system-documentation.md) - Complete reference

### 🎨 Customize
- Configure LLM settings (Settings → LLM Settings)
- Upload custom patient avatars
- Create complex clinical scenarios

### 🚀 Deploy
See production checklist in [System Documentation](../reference/system-documentation.md#deployment)

---

## Default Admin Credentials (Example)

If you followed this guide:
- **Username:** `admin`
- **Email:** `admin@example.com`
- **Password:** `admin123`

**⚠️ Change these in production!**

---

## Quick Command Reference

```bash
# Start application
npm run dev

# Reset database
rm server/database.sqlite

# Check backend
curl http://localhost:3000/api/auth/verify

# View logs
# Frontend: Browser console
# Backend: Terminal where npm run dev is running
```

---

## Support

Having issues? Check:
1. Is `server/.env` created?
2. Is port 3000 available?
3. Are dependencies installed? (`npm install`)
4. Any errors in terminal/console?

---

**🎉 You're all set! Enjoy VipSim with secure authentication!**
