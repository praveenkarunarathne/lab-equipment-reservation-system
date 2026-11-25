Feature: Reserve lab equipment
  As a student
  I want to book a one-hour slot on a piece of lab equipment
  So that I can be sure the equipment is free when I arrive at the lab

  Background:
    Given the current time is "Mon 26 Oct 2026 08:00" in Colombo
    And the equipment "Digital Oscilloscope" is available
    And I am signed in as the student "student1@qa.test"

  Scenario: Book a free slot
    When I book "Digital Oscilloscope" for "Tue 27 Oct 2026 10:30"
    Then the booking is accepted
    And "Tue 27 Oct 2026 10:30" is no longer offered for "Digital Oscilloscope"

  Scenario: Another student already holds the slot
    Given the student "student2@qa.test" has booked "Digital Oscilloscope" for "Tue 27 Oct 2026 10:30"
    When I book "Digital Oscilloscope" for "Tue 27 Oct 2026 10:30"
    Then the booking is rejected with "RESERVATION_CONFLICT"

  Scenario: Equipment goes into maintenance after I booked it
    Given I have booked "Digital Oscilloscope" for "Tue 27 Oct 2026 10:30"
    When an administrator puts "Digital Oscilloscope" into maintenance because "Probe calibration"
    Then my booking for "Tue 27 Oct 2026 10:30" is cancelled with reason "equipment_maintenance"

  Scenario Outline: Only legal slots can be booked
    When I book "Digital Oscilloscope" for "<slot>"
    Then the booking is <result>

    Examples:
      | slot                  | result                             |
      | Tue 27 Oct 2026 08:30 | accepted                           |
      | Tue 27 Oct 2026 15:30 | accepted                           |
      | Tue 27 Oct 2026 16:30 | rejected with "VALIDATION_ERROR"   |
      | Sat 31 Oct 2026 10:30 | rejected with "VALIDATION_ERROR"   |
      | Tue 10 Nov 2026 10:30 | rejected with "VALIDATION_ERROR"   |
