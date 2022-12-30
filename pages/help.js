import {
  Stack,
  Heading,
  Text,
  Button,
  Link,
  OrderedList,
  ListItem,
} from "@chakra-ui/react";

export default function Help() {
  return (
    <Stack w={["95%", 960]} spacing={6}>
      <Heading as="h1" size="2xl">
        Getting Started
      </Heading>
      <Text>
        You can use DataPipe with any online experiment. You can even use it
        with a laboratory experiment, as long as you have an internet
        connection. This guide will walk you through the steps for a typical
        online experiment using tools that are widely available and free.
      </Text>
      <Heading as="h2" size="lg">
        Create an OSF project for your experiment
      </Heading>
      <Text>
        The next step is to create an OSF project for your experiment. You can
        create an OSF project at{" "}
        <Link isExternal href="https://osf.io">
          https://osf.io
        </Link>
        . You will need to create an account if you do not already have one.
        Once you have created an account, click the Create Project button to
        create a new project. You can name your project whatever you want.
      </Text>
      <Heading as="h2" size="lg">
        Link your OSF account to DataPipe
      </Heading>
      <Text>
        In order for DataPipe to have permission to send files to your OSF
        account, you need to create an authorization token on the OSF and add
        the token to your DataPipe account. To create an authorization token, go
        to your OSF account settings by clicking your name in the top right
        corner of the screen and selecting Settings. Then click the Personal
        Access Tokens tab. Click the Create Token button. Give the token a name
        (we recommend a name that is specific to DataPipe so that you can easily
        disable the token when you are done using DataPipe) and select
        &quot;osf.full_write&quot; as the scope. Click the Create Token button
        to finish creating the token. You will be shown the token value. Copy
        the token value.
      </Text>
      <Text>
        On DataPipe, click the Account button in the top right corner and select
        Settings. Click the Set OSF Token button and paste the token value into
        the box. Click Change Token to finish. You should see the icon become a
        green checkmark to indicate that you have a valid token.
      </Text>
      <Heading as="h2" size="lg">
        Create a DataPipe experiment
      </Heading>
      <Text>
        The next step is to create an experiment on DataPipe. Click the New
        Experiment button in the top right corner. Give your experiment a name
        and enter the OSF project ID. This ID is part of the URL of the OSF
        project. For example, if the URL of your OSF project is
        https://osf.io/abcde/, then the project ID is abcde.
      </Text>
      <Text>
        When you create an experiment, DataPipe will automatically create a new
        Data component on the OSF project. The Data component is where DataPipe
        will store the data files that it sends to the OSF project. Enter the
        name you would like to use for the Data component.
      </Text>
      <Text>
        There are two three optional features that you can enable for your
        experiment. (These can be adjusted later if you change your mind.)
      </Text>
      <Text>
        <span style={{ fontWeight: "bold" }}>Condition assignment</span> will
        allow you to request the next sequential condition number from DataPipe.
        For example, if you have 4 conditions in the experiment, DataPipe will
        respond to the first request with 0, the next request with 1, then 2,
        then 3, and then cycle back to 0.
      </Text>
      <Text>
        <span style={{ fontWeight: "bold" }}>Data validation</span> will check
        the data as it is sent to DataPipe. If the data are invalid, then
        DataPipe will not send the data to the OSF. The basic data validation
        features are to check if the data file is a valid JSON or CSV file. Once
        you have created the experiment, you can also specify a list of required
        fields that the JSON or CSV must have in order to be considered valid.
        This is a useful feature to enable because it limits the potential for
        malicious use of DataPipe. One risk of using DataPipe is that it creates
        an open path to create files in your OSF project. A malicious and
        technically savvy user could potentially create spam data and send the
        files to your OSF account. Turning on validation makes it harder to do
        this.
      </Text>
      <Text>
        <span style={{ fontWeight: "bold" }}>The session limit</span> will cap
        the number of data files that can be sent to your OSF project. This is
        another way to limit the potential for malicious use. If you set the
        session limit to 100, then DataPipe will only send the first 100 data
        files that it receives. You can adjust the session limit later if you
        need to increase it.
      </Text>
      <Heading as="h2" size="lg">
        Add code to your experiment to send data to DataPipe
      </Heading>
      <Text>
        In order to send data to DataPipe, you need to add code to your
        experiment. If you are using jsPsych, then you can use the jsPsychPipe
        plugin. If you are not using jsPsych, then you can use the DataPipe API
        directly via fetch requests.
      </Text>
      <Text>
        After creating an experiment in the previous step, you will be sent to
        the experiment page. You can also get to the experiment page by clicking
        My Experiments in the top menu and selecting the experiment you want to
        view. On this page, there are code snippets for sending data to
        DataPipe. Select the code snippet for the language that you are using in
        your experiment and follow the guide to add the code to your experiment.
      </Text>

      <Heading as="h2" size="lg">
        Publish your experiment
      </Heading>
      <Text>
        The first step is to publish your experiment online so that participants
        can view it. You can use any tool that allows you to publish a web page,
        such as university web hosting, GitHub Pages, or Netlify. We will
        describe how to use GitHub Pages, since it is free, accessible, and
        relatively easy to use. This guide will assume no familiarity with
        GitHub or git version control. We will describe the easiest way to get
        started for someone with no experience using GitHub, but if you are
        already familiar with GitHub, the approach we take here is probably not
        the best way to do things and you should feel free to follow your own
        preferred workflow.
      </Text>
      <Text>
        First, create a GitHub account at{" "}
        <Link isExternal href="https://www.github.com">
          https://github.com
        </Link>{" "}
        if you do not already have one. Then go to{" "}
        <Link isExternal href="https://www.github.com/new">
          https://github.com/new
        </Link>{" "}
        to create a new repository. You can name it whatever you want, but the
        name that you give it will become part of the URL that you use to access
        your experiment. Therefore, you may want to avoid names that reveal
        information that you want to keep hidden from the participants. Check
        the box to add a README file. The rest of the settings can be left at
        their default values. Click the &quot;Create repository&quot; button to
        create the repository.
      </Text>
      <Text>
        Next, we need to configure the repository to share its content as a
        webpage. Go to the Settings tab of your repository. Select the Pages
        menu item on the left side. For Source, leave it as deploy from a
        branch. Under branch select main as the source. Click the save button to
        finish this step.
      </Text>
      <Text>
        Now we need to add the experiment files to the repository. We are going
        to assume that you already have your experiment created and that it is
        written in JavaScript / CSS / HTML. In your GitHub repository, click the
        Add Files button near the top of the screen and select Upload Files.
        Drag and drop your experiment files into the upload box. You can also
        click the upload box to select the files from your computer. Once you
        have uploaded all of your experiment files, click the Commit Changes
        button.
      </Text>
      <Text>
        That&apos;s it! Your experiment is now published on the web. You can
        view it by going to https://[your username].github.io/[your repository
        name]. If your HTML file is not named index.html, then you need to add
        the name of the HTML file to the end of the URL. For example, if your
        HTML file is called experiment.html, then the URL would be https://[your
        username].github.io/[your repository name]/experiment.html. It may take
        a few minutes for the uploaded files to be available as a website.
      </Text>
      <Heading as="h2" size="lg">
        Activate your experiment
      </Heading>
      <Text>
        The final step is to activate your experiment. On the DataPipe
        experiment page, you can activate three different features of DataPipe
        for each experiment.
      </Text>

      <Text>
        <span style={{ fontWeight: "bold" }}>Enable data collection</span> will
        activate the standard data collection feature. This enables sending text
        files (e.g., JSON or CSV) to your OSF project.
      </Text>
      <Text>
        <span style={{ fontWeight: "bold" }}>
          Enable base64 data collection
        </span>{" "}
        activates base64-based data collection. Base 64 is a way to encode files
        as strings, and can be used for collecting data like audio recordings,
        video recordings, or images.
      </Text>
      <Text>
        <span style={{ fontWeight: "bold" }}>Enable condition assignment</span>{" "}
        activates the condition assignment feature. This allow you to request
        the next condition from DataPipe.
      </Text>
      <Text>
        We strongly recommend that you only activate the minimum features that
        you need for your experiment and that you only activate features during
        active data collection. This will reduce the risk of malicious use of
        DataPipe.
      </Text>

      <Heading as="h2" size="lg">
        Try it out!
      </Heading>
      <Text>
        At this point you should be ready to collect data. We recommend testing
        data collection carefully at this point to ensure everything is properly
        configured. You should see data files created on your OSF data component
        immediately after you finish the experiment.
      </Text>
    </Stack>
  );
}
