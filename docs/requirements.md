# Little Hands — Project Requirements & Development Brief

## 1. Project Overview

We are planning to develop **Little Hands**, a Kindergarten and Tuition Management System.

The primary objective is to digitize student records, parent information, class enrollment, individual fee management, payment history, and student schedules.

The system should be simple, reliable, easy to use, and designed around the actual administrative requirements of a kindergarten.

**Important:** This is currently a requirements and planning stage. Do not start implementing features or generating code until the requirements have been reviewed and the development approach has been approved.

## 2. Student Management

Every student must have an individual profile with a unique student ID.

Each profile should support:

- Unique student ID (automatically generated).
- Student's full name.
- Date of admission / joining date.
- Class or enrollment information.
- Student photograph (optional initially; support adding it later).
- Student status (Active, Inactive, Graduated).
- Additional notes if necessary.

Student photographs should not be mandatory during initial registration. The system should allow photographs to be uploaded later.

## 3. Class Management

Little Hands currently has four educational categories:

1. Playgroup
2. LKG (Lower Kindergarten)
3. UKG (Upper Kindergarten)
4. Tuition

The system must support these categories and allow students to be assigned to the appropriate classes.

**Important requirement:**

A student may potentially attend more than one program simultaneously.

For example:
- A student may attend LKG and Tuition.
- Each enrollment may have a different schedule.
- Each enrollment may have a different fee arrangement.

This multiple-enrollment requirement is provisional and needs confirmation before finalizing the database design.

Avoid designing the system around the assumption that one student can belong to only one class.

## 4. Parent and Guardian Management

Each student must have associated parent or guardian information.

Required information:

- Father's name.
- Father's phone number.
- Mother's name.
- Mother's phone number.
- Residential address.
- Emergency contact number.
- Guardian relationship, where applicable.

The system should support multiple parent or guardian contacts for one student.

Parent information should be linked to the student record rather than duplicated unnecessarily.

## 5. Individual Fee Management

One of the most important requirements is flexible, student-specific fee management.

Different students may pay different amounts depending on their arrangements and the programs they attend.

Therefore, fees must NOT be hardcoded based on class.

Each student's fee arrangement should support:

- Agreed fee amount.
- Associated class/enrollment.
- Fee frequency (monthly, term-wise, or other).
- Effective date.
- Discounts or concessions, if applicable.
- Additional remarks.

The fee amount must be configurable individually.

The system should eventually support different fee arrangements for different enrollments belonging to the same student.

## 6. Payment History

Every student must have a complete payment history.

This is a core requirement.

The system must maintain individual payment transactions rather than simply storing the latest payment amount.

Each payment record should contain:

- Payment ID.
- Student reference.
- Associated enrollment or fee agreement.
- Amount paid.
- Payment date and time.
- Payment method (Cash, UPI, Bank Transfer, etc.).
- Fee period covered (month, term, etc.).
- Transaction/reference number (optional).
- Remarks or notes.
- Outstanding balance after payment, or enough information to calculate it reliably.

### Payment requirements

The system must support:

- Full payments.
- Partial payments.
- Multiple payments against one fee period.
- Tracking outstanding balances.
- Identifying fully paid and partially paid periods.
- Viewing the complete chronological payment history.
- Calculating total fees collected.
- Generating monthly collection reports.
- Viewing payment history from an individual student's profile.

Never overwrite previous payment transactions when a new payment is entered.

Payment records should be preserved. Corrections should use an auditable adjustment or reversal mechanism rather than silently deleting financial history.

### Example

A student's agreed monthly fee is ₹1,500.

The parent pays ₹1,000 initially.

The system should show:
- Agreed fee: ₹1,500.
- Amount paid: ₹1,000.
- Outstanding balance: ₹500.
- Payment status: Partially Paid.

If the parent subsequently pays ₹500, the system should update the balance to zero while retaining both transactions in the payment history.

## 7. Individual Student Schedules

Students may have different arrival and departure timings.

The system must support individual schedules rather than assuming all students follow identical school timings.

Each student's schedule should contain:

- Expected arrival time.
- Expected departure time.
- Associated class/enrollment.
- Applicable days, if schedules differ by day.
- Schedule effective date, if needed.

The system should distinguish between:

**Expected timings**
- When the student is supposed to arrive.
- When the student is supposed to leave.

**Actual timings**
- When the student actually arrived.
- When the student actually departed.

This will provide the foundation for attendance tracking.

Schedules should be configurable independently for each enrollment if multiple simultaneous enrollments are confirmed.

## 8. Dashboard Requirements

The administrative dashboard should eventually provide:

- Total number of students.
- Number of students in each class.
- Recent admissions.
- Today's attendance overview.
- Expected student arrivals.
- Monthly fee collections.
- Outstanding fee balances.
- Recent payment transactions.

The dashboard should provide a quick overview of the kindergarten's daily operations.

## 9. Suggested Data Architecture

Evaluate the following entities when designing the database:

1. Students
   - Student identity and admission details.

2. Guardians
   - Parent and guardian contact information.

3. Student-Guardian Relationships
   - Links students with their parents or guardians.

4. Classes / Programs
   - Playgroup, LKG, UKG, Tuition.

5. Enrollments
   - Student enrollment in one or more programs.
   - Academic year and enrollment status.

6. Fee Agreements
   - Individual fee arrangements associated with students and enrollments.

7. Payments
   - Individual payment transactions and their history.

8. Schedules
   - Individual expected arrival and departure timings.

9. Attendance
   - Actual arrival and departure records.

This is a proposed conceptual structure, not a finalized schema. Review relationships, constraints, and possible edge cases before implementation.

## 10. Important Design Principles

- One central student profile.
- Support multiple guardians per student.
- Support multiple enrollments per student, subject to confirmation.
- Individual fee arrangements.
- Complete and auditable payment history.
- Flexible student-specific schedules.
- Student photos can be added later.
- Avoid unnecessary duplication of information.
- Maintain financial data integrity.
- Make the system easy for non-technical administrative staff to operate.

## 11. Pending Confirmations

Do not silently assume answers to these questions.

1. Can students attend kindergarten and tuition simultaneously? This is expected to be supported, but confirmation is pending.
2. Are fees monthly, term-wise, or variable depending on the student?
3. Are arrival and departure schedules fixed per student or subject to daily changes?
4. Does the kindergarten operate on an academic-year basis?
5. Should the system include attendance marking in the first development version?
6. Should payments support fee discounts and concessions from the beginning?

Keep these as explicit open requirements.

## 12. Instructions to the Development Agent

For now, act as a software architect and requirements analyst.

Your first tasks are:

1. Understand and organize all the requirements.
2. Identify missing information and potential edge cases.
3. Identify relationships between students, guardians, enrollments, fees, payments, and schedules.
4. Propose a suitable database architecture.
5. Recommend an appropriate technology stack.
6. Propose a modular development roadmap.
7. Identify security, privacy, and data-integrity considerations, especially because the system stores children's personal information and financial records.

Do not prematurely introduce complex infrastructure or unnecessary features.

Do not start coding until the requirements, architecture, and initial development plan have been reviewed and approved.

**The priority is to build a reliable, maintainable kindergarten management system that solves Little Hands' actual administrative problems.**