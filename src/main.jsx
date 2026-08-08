import React from 'react'
import ReactDOM from 'react-dom/client'
import App, { CustomerApp } from './App'

// Route BEFORE React renders anything.
// #<token>    → customer ordering view (new hash-based encrypted format)
// ?o=<token>  → customer ordering view (query param format, legacy)
// ?table=<n>  → customer ordering view (legacy)
// Otherwise   → full POS (protected by staff PIN gate)
const params = new URLSearchParams(window.location.search)
const hashToken = window.location.hash.replace(/^#/, '')
const isCustomer = hashToken.length > 2 || params.has('o') || params.has('table')
const Root = isCustomer ? CustomerApp : App

ReactDOM.createRoot(document.getElementById('root')).render(<Root />)
