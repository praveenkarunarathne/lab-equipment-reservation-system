Feature: Report and resolve equipment faults
  As a student I want to report broken equipment,
  and as an administrator I want to record how it was fixed.

  Background:
    Given the current time is "Mon 26 Oct 2026 08:00" in Colombo
    And the equipment "Digital Oscilloscope" is available

  Scenario: A student reports a fault and an administrator resolves it
    Given I am signed in as the student "student1@qa.test"
    When I report a "malfunction" on "Digital Oscilloscope" titled "Channel 2 is dead"
    Then my fault report is "open"
    When an administrator resolves the report with "Replaced the channel 2 input board"
    Then my fault report is "resolved"

  Scenario: Students cannot see each other's fault reports
    Given the student "student2@qa.test" has reported a fault on "Digital Oscilloscope"
    And I am signed in as the student "student1@qa.test"
    When I open that fault report
    Then I get a "RESOURCE_NOT_FOUND" error
