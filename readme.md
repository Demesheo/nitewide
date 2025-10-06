# Nitewide - Nightlife Platform

Nitewide is a nightlife discovery and prebooking platform for clubs, packages, and special events. The backend is built with Node.js, Express, PostgreSQL (Sequelize ORM), and supports future frontend, payment, and cloud scalability.

---

# Nitewide Weekly Plan & Task Tracker

| Task Category            | Task / Feature                                                  | Status           | Priority | Notes / Next Steps                                     | Target Week |
|---------------------------|-----------------------------------------------------------------|----------------|----------|--------------------------------------------------------|------------|
| **Backend Setup**         | Node.js + Express + Sequelize + PostgreSQL                     | ✅ Done        | High     | Initial server & DB connection                         | Week 1     |
|                           | Models: MetropolitanArea, Club, Package, Event                | ✅ Done        | High     | Associations established                                | Week 1     |
|                           | Seed Script: metros, clubs, packages, events                  | ✅ Done        | High     | Top 10 clubs per city seeded                             | Week 1     |
|                           | Root & Health Check Routes                                      | ✅ Done        | High     | Publicly available health route                          | Week 1     |
| **Routes & API**          | Events & Clubs routes refactored                               | ✅ Done        | High     | Pagination added, optional packages                     | Week 2     |
|                           | Search & Filter: city, state, genre, distance-based           | 🔄 In Progress | High     | Include radius search & lat/lon edge-case handling     | Week 2-3   |
|                           | Sponsored/promoted listing prioritization                     | 🔄 Planned     | Medium   | Paid plan club support in future                        | Week 3-4   |
| **Geolocation**           | PostGIS setup & distance calculations                          | 🔄 In Progress | High     | Needed for radius search & nearest-first ordering      | Week 2-3   |
|                           | Geocode clubs/events automatically                             | 🔄 Planned     | Medium   | Integrate into admin panel for future scalability      | Week 3-4   |
| **Seed Data Expansion**   | Include top 10 clubs per city (Miami, Orlando, Tampa)         | ✅ Done        | High     | Real addresses and lat/lon                               | Week 1     |
|                           | Include private/festival locations                             | 🔄 Planned     | Medium   | To support music/food festivals & private events       | Week 3     |
| **Admin & Future Features** | Admin panel: club/event onboarding                              | 🔄 Planned     | Medium   | Auto-geocode and future location handling              | Week 3-5   |
|                           | Payment provider integration                                    | 🔄 Planned     | Medium   | Stripe / PayPal integration for future monetization   | Week 4-5   |
|                           | Timezones support for events                                    | 🔄 Planned     | Low      | For accurate event scheduling across regions          | Week 5     |
| **Frontend (Projected)**  | MVP UI for clubs & events search & listing                     | 🔄 Planned     | High     | React/Next.js with paginated results, filters         | Week 4-5   |
|                           | Promoted listing display & sponsored club labels               | 🔄 Planned     | Medium   | To reflect paid plans                                 | Week 5     |
| **Deployment & Scaling**  | Cloud provider setup: AWS/GCP/Heroku                            | 🔄 Planned     | Medium   | DB + backend + static frontend hosting                 | Week 5-6   |
|                           | Scalability planning & caching                                   | 🔄 Planned     | Low      | Future performance optimization                        | Week 6     |



## Table of Contents

- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Database Setup and Seeding](#database-setup-and-seeding)
- [Running the Application](#running-the-application)
- [API Endpoints](#api-endpoints)
- [System Architecture](#system-architecture)
- [Future Implementations](#future-implementations)
- [License](#license)

---

## Getting Started

**Prerequisites**

- Node.js >= 20
- npm >= 10
- PostgreSQL >= 15
- Git (optional)

**Install dependencies**

\`\`\`bash
npm install
\`\`\`

**Environment Variables**

Create a \`.env\` file in the root directory:

\`\`\`env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=yourpassword
DB_NAME=nitewide_dev
\`\`\`

---

## Project Structure

\`\`\`
/nitewide
├─ /config
│   └─ database.js          # Sequelize database connection
├─ /models
│   ├─ Club.js
│   ├─ Package.js
│   └─ Event.js
├─ /routes                  # Future route modules
├─ /seeds
│   └─ seed_all.js
├─ index.js                 # Main Express server
└─ README.md
\`\`\`

---

## Database Setup and Seeding

1. **Create the database manually in PostgreSQL**

\`\`\`sql
CREATE DATABASE nitewide_dev;
\`\`\`

2. **Run seed script to populate clubs, packages, and events**

\`\`\`bash
node seeds/seed_all.js
\`\`\`

- Top clubs get full package options  
- Holidays and major events added up to Valentine's Day  
- Clubs without data will not have packages/events  

---

## Running the Application

**Start the server**

\`\`\`bash
npm start
\`\`\`

**Verify server is running**

GET /debug/clubs


Returns:

\`\`\`json
[
  {
    "id": "uuid",
    "name": "ICEBAR Orlando",
    "address": "8967 International Dr, Orlando, FL 32819",
    "lat": 28.4275,
    "lon": -81.4721,
    "packageCount": 3,
    "packages": [
      {"id":"uuid","name":"VIP 2 Bottles + 5 Entries","price":500,"description":null,"isDefault":true},
      ...
    ]
  }
]
\`\`\`

---

## API Endpoints

Currently available endpoints:

| Method | Endpoint        | Description                    |
|--------|----------------|--------------------------------|
| GET    | `/`             | Health check                   |
| GET    | `/debug/clubs`  | Returns clubs and packages     |

> Future endpoints: `/events`, `/packages`, `/admin/*`, user auth, and bookings.

---

## System Architecture

**ASCII-style diagram**

\`\`\`
             ┌───────────────┐
             │   Frontend    │  (React, Next.js - future)
             └──────┬────────┘
                    │ API Requests
                    ▼
             ┌───────────────┐
             │   Backend     │  (Node.js + Express)
             ├───────────────┤
             │ /debug, /clubs│
             │ /events, etc  │
             └──────┬────────┘
                    │ Sequelize ORM
                    ▼
             ┌───────────────┐
             │ PostgreSQL DB │  (Clubs, Packages, Events)
             └───────────────┘

Future integrations:
 - Payments: Stripe / PayPal
 - Cloud: AWS / GCP / Azure
 - CDN / Media: CloudFront, S3
 - Microservices: Notification service, Analytics service
 - Caching: Redis for session & frequent queries
 - Geolocation: Google Maps API / OpenStreetMap
 - Scaling: Load balancers, containerized services (Docker/Kubernetes)
\`\`\`

---

## Future Implementations

- **Frontend:** React/Next.js SPA with user dashboard, search, and booking flow  
- **Payments:** Integrate Stripe for package and entry purchases  
- **Cloud:** Deploy backend on AWS/GCP/Azure, PostgreSQL managed service  
- **Scalability:** Containerized services (Docker/K8s), horizontal scaling  
- **Notifications:** SMS/Email via Twilio / SendGrid  
- **Self-Onboarding:** Allow clubs to claim profiles and manage packages  

---

## License

MIT License
