# OpsPM360: Enterprise Project Portfolio Management
## Detailed System Blueprint & Delivery Framework

### 1. Project Context & Environment
The OpsPM360 platform is designed to orchestrate complex IT infrastructure and operational projects within a demanding, multi-site mining environment. It specifically addresses the coordination challenges between site operations (e.g., at Sabodala and Saly) and central IT infrastructure, ensuring continuous alignment across all seven IT divisions. 

**The 7 Key Divisions & Their System Roles:**
*   **Operations:** Day-to-day site management. Requires mobile-first, tablet-friendly "Zen Mode" interfaces for quick task updates and roadblock logging.
*   **Infrastructure:** Networks and systems deployment. Needs timeline dependency locking tied directly to site readiness.
*   **Enterprise Architecture:** Future design. Requires projects to carry strategic tags mapping to the long-term enterprise blueprint.
*   **Information Security:** Cyber defense and governance. Needs automated routing for network-altering tasks to dedicated security queues (e.g., Hamady Soumare's InfoSec review pool).
*   **Data Insight:** Business intelligence. Requires raw, clean access to the PostgreSQL database for ingestion into wider corporate BI dashboards.
*   **Business Apps:** ERP integration. Monitors operational bandwidth before deploying application updates.
*   **Group IT Management:** Executive oversight. Needs instant extraction of project statuses into clean, formatted presentation decks, facilitating high-level reviews and logistical planning with coordinators like Troy.

### 2. Core Architecture & Technology Stack
*   **Frontend UX/UI:** React.js (Next.js) configured as a Progressive Web App (PWA). Employs TailwindCSS for a flat, modern, and highly ergonomic interface.
*   **Backend API:** Node.js with Express, providing lightweight, asynchronous endpoints.
*   **Database:** PostgreSQL.
*   **Local State & Offline Sync:** IndexedDB on the client side handling data via an Optimistic Concurrency Control (OCC) mechanism. 
*   **Reporting Engine:** Puppeteer or PptxGenJS integrated directly into the Node.js backend for automated slide deck extraction.

### 3. Database Schema & Offline-Sync Logic (PostgreSQL)
To support seamless offline capabilities when site connectivity drops, the system utilizes Row-Level Versioning:
*   **Projects Table:** `id`, `name`, `division`, `cgeit_tag`, `overall_status`, `version` (INT), `updated_at`.
*   **Tasks Table:** `id`, `project_id`, `assignee`, `dependency_lock`, `status`, `version`, `updated_at`.
*   **Sync Queue (JSONB):** A dedicated table to catch and process incoming offline payloads.
*   **Conflict Resolution:** When local payloads sync to the cloud, the system compares the local `version` to the server `version`. If matched, the update commits and increments the version. If mismatched, a "Last Write Wins" algorithm applies via `updated_at`, or a soft conflict is flagged for manual merge by the project owner.
*   **Audit Logs:** An immutable ledger tracking all state changes to ensure full CGEIT compliance and risk optimization tracking.

### 4. UI/UX Ergonomics & "Zero-Training" Requirement
*   **Frictionless Entry:** Operators must be able to log roadblocks or update statuses in under three interactions.
*   **Drag-and-Drop:** Visual Kanban boards for task progression.
*   **Contextual Dashboards:** The system automatically identifies the user's role and site, presenting only relevant data. A site IT manager sees immediate tactical tasks; a Group IT manager sees portfolio health.
*   **Visual Urgency:** Subtle UI cues (e.g., amber pulsing borders) for SLAs nearing breach, avoiding notification fatigue.

### 5. Product Delivery Quality & Success Conditions (Validation Gates)
To confirm the product is ready for production, it must pass the following strict evaluation criteria:
*   **SC1 (Resilience & Offline Sync):** The application successfully accepts a task update and a new roadblock log while completely disconnected from the network, and flawlessly merges the data into PostgreSQL using OCC upon reconnection.
*   **SC2 (Dependency Locking):** An Infrastructure deployment task remains visually locked and un-actionable until the prerequisite Operations site-prep task is explicitly marked complete.
*   **SC3 (Ergonomics):** A user can update a task status and assign a new roadblock via a touch-device simulator in under 3 clicks/taps.
*   **SC4 (Security & Governance):** Any project tagged with "Network Alteration" automatically generates an approval gate that suspends progression until cleared by the InfoSec division.
*   **SC5 (Executive Extraction):** The system generates a perfectly formatted PPTX/PDF slide deck containing the latest statuses, blockers, and next actions for all active projects, grouped by division, with zero manual formatting required.
