# Revenue Analytics Dashboard

## Overview

Revenue Analytics Dashboard is a professional web-based business intelligence and performance monitoring platform designed to track revenue targets, achievements, order metrics, AOV (Average Order Value), and year-over-year performance.

The dashboard provides leadership teams with a centralized view of business KPIs through interactive visualizations, summary cards, trend analysis, and AI-powered insights.

The application is built using HTML, CSS, and JavaScript, with data sourced from structured spreadsheet datasets and processed directly within the frontend.

---

## Key Features

### Performance Monitoring

* Targets vs Achievement tracking
* Collection performance analysis
* Order performance tracking
* AOV (Average Order Value) monitoring
* Year-over-Year (YoY) comparison

### Leader-Based Filtering

Filter dashboard data by:

* All Leaders
* Sanyam
* Rajat
* Mridul
* Manish (Offline)
* Manish (Online)
* Test Series
* Nikhil

### Date Range Analysis

* Custom date selection
* Dynamic metric recalculation
* Period-based comparisons

### KPI Summary Cards

Displays key business metrics including:

* Target Collection
* Achieved Collection
* Last Year YTD
* Target AOV
* Achieved AOV
* Target Orders
* Achieved Orders

### Dashboard Modules

#### TVA (Targets vs Achievement)

Tracks overall target fulfillment and performance.

#### Month-Wise Analysis

Monthly revenue and order breakdown.

#### LY vs TY

Compare current year performance against previous year.

#### AOV Analysis

Average Order Value tracking and benchmarking.

#### Type-Wise AOV

AOV breakdown by category or business type.

#### Generic Name Analysis

Category-level performance tracking.

#### Batch AOV

Performance comparison across batches.

#### DoD Trend

Day-over-Day trend analysis.

#### EdTech Analytics

Education-specific performance metrics and insights.

---

## AI-Powered Insights

The dashboard integrates the Groq API to provide AI-generated insights and summaries.

### AI Capabilities

* KPI Explanation
* Trend Interpretation
* Revenue Analysis
* Performance Summaries
* Business Insights
* Data Understanding Assistance

### Powered By

* Groq API
* LLM-based analytics assistant

---

## Technology Stack

### Frontend

* HTML5
* CSS3
* JavaScript (Vanilla JS)

### Data Source

* Spreadsheet / Sheet-Based Dataset
* Hardcoded JSON Structures
* Client-Side Data Processing

### AI Integration

* Groq API

---

## Project Structure

```text
Revenue-Analytics-Dashboard/
│
├── index.html
├── css/
│   ├── style.css
│   ├── dashboard.css
│
├── js/
│   ├── main.js
│   ├── filters.js
│   ├── charts.js
│   ├── calculations.js
│   ├── ai.js
│
├── assets/
│   ├── icons/
│   ├── images/
│
├── data/
│   ├── revenueData.js
│   ├── leaderData.js
│   ├── monthlyData.js
│
└── README.md
```

---

## Data Management

The current version uses hardcoded spreadsheet data converted into JavaScript objects.

Example:

```javascript
const dashboardData = [
  {
    exam: "NEET",
    leader: "Sanyam",
    targetCollection: 88.9,
    achievedCollection: 4.4,
    targetOrders: 160000,
    achievedOrders: 7400,
    targetAOV: 5543,
    achievedAOV: 5917
  }
];
```

Future versions can be connected to:

* Google Sheets API
* MySQL
* PostgreSQL
* Airtable
* REST APIs
* Data Warehouses

---

## Installation

### Clone Repository

```bash
git clone https://github.com/yourusername/revenue-analytics-dashboard.git
```

### Navigate to Project

```bash
cd revenue-analytics-dashboard
```

### Run Locally

Simply open:

```text
index.html
```

or serve using:

```bash
npx serve .
```

---

## Configuration

### Groq API Setup

Create a configuration file:

```javascript
const GROQ_API_KEY = "YOUR_API_KEY";
```

or use environment variables if deploying via backend.

Example request:

```javascript
const response = await fetch(
  "https://api.groq.com/openai/v1/chat/completions",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-4",
      messages: [
        {
          role: "user",
          content: "Analyze dashboard performance"
        }
      ]
    })
  }
);
```

---

## Dashboard Metrics

### Collection Metrics

Measures:

* Target Collection
* Achieved Collection
* Collection Achievement %

### Order Metrics

Measures:

* Target Orders
* Achieved Orders
* Order Achievement %

### AOV Metrics

Measures:

* Target AOV
* Achieved AOV
* AOV Variance

### Growth Metrics

Measures:

* YoY Growth
* Month-over-Month Trends
* Day-over-Day Trends

---

## Export Features

* PNG Export
* Tabular Reports
* KPI Snapshots

---

## Future Enhancements

### Planned Improvements

* Live Google Sheets Integration
* Database Connectivity
* User Authentication
* Role-Based Access Control
* Real-Time Data Refresh
* Advanced AI Agent
* Automated Report Generation
* PDF Export
* Telegram/Slack Notifications
* Forecasting Models

---

## Performance

The dashboard is optimized for:

* Fast client-side rendering
* Lightweight architecture
* Minimal dependencies
* Quick filtering and aggregation

---

## Use Cases

* Revenue Monitoring
* Sales Performance Tracking
* Leadership Reviews
* EdTech Business Analytics
* Monthly Business Reviews
* Operational Reporting
* Strategic Planning

---

## Author

Developed using:

* HTML
* CSS
* JavaScript
* Groq API

Built to provide business leaders with actionable performance insights through interactive dashboards and AI-assisted analytics.

---

## License

This project is licensed under the MIT License.
