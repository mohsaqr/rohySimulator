import React, { createContext, useContext, useState, useEffect } from 'react';
import { AuthService } from '../services/authService';
import { apiUrl } from '../config/api';

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check if user is already logged in on mount
        const verifyUser = async () => {
            try {
                const userData = await AuthService.verifyToken();
                setUser(userData);
            } catch (error) {
                console.error('Token verification failed:', error);
                setUser(null);
            } finally {
                setLoading(false);
            }
        };

        verifyUser();
    }, []);

    const login = async (username, password) => {
        const data = await AuthService.login(username, password);
        setUser(data.user);
        return data;
    };

    const register = async (username, email, password) => {
        const data = await AuthService.register(username, email, password);
        setUser(data.user);
        return data;
    };

    const logout = async () => {
        // Log logout event to backend
        try {
            const token = AuthService.getToken();
            if (token) {
                await fetch(apiUrl('/auth/logout'), {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
            }
        } catch (error) {
            console.error('Failed to log logout:', error);
        }
        
        AuthService.logout();
        setUser(null);
    };

    const isAdmin = () => {
        return user?.role === 'admin';
    };

    const value = {
        user,
        loading,
        login,
        register,
        logout,
        isAdmin,
        isAuthenticated: !!user
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
